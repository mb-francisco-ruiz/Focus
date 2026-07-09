import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { FOCUS_TOOL_NAMES, focusTools } from "./tools.js";
import { COMPUTER_TOOL_NAMES, computerTools, latestShots } from "./computer.js";

/**
 * Focus local-AI sidecar. Runs the Ask Focus assistant and one-shot enrichment
 * through the user's local Claude Code login (Agent SDK) instead of the server
 * API — so the AI draws on their Claude subscription. Spawned by the Tauri host,
 * which reads the {port,token} handshake from stdout and proxies webview calls.
 */

const TOKEN = randomUUID();

/** Drive one agent turn; return the final assistant text. */
async function runQuery(prompt, options) {
  let result = null;
  for await (const msg of query({ prompt, options })) {
    if (msg.type === "result") result = msg;
  }
  if (!result) throw new Error("no result from agent");
  if (result.subtype !== "success") {
    throw new Error(`agent ${result.subtype}${result.api_error_status ? ` (${result.api_error_status})` : ""}`);
  }
  return result.result;
}

async function claudeVersion() {
  return new Promise((resolve) => {
    execFile("claude", ["--version"], { timeout: 8000 }, (err, stdout) => {
      resolve(err ? null : stdout.trim());
    });
  });
}

/** Ask Focus: agent loop with the Focus API tools + a computer-control launcher. */
async function assistant({ system, messages, focusBaseUrl, jwt }) {
  // Lets the assistant hand a "do it on my Mac" request to the control loop.
  // Fire-and-forget: the client sees control.running and jumps to the live view.
  const controlLauncher = tool(
    "control_computer",
    "Operate the user's Mac (open apps, browse, click, type) to accomplish a task. Use this when the user asks you to DO something on their computer rather than manage their task list. Give a clear, self-contained task description.",
    { task: z.string() },
    async ({ task }) => {
      if (!control.running) void runControl(task);
      return { content: [{ type: "text", text: `Started controlling the Mac: ${task}` }] };
    },
    { annotations: { destructiveHint: true } },
  );
  const server = createSdkMcpServer({
    name: "focus",
    tools: [...focusTools({ baseUrl: focusBaseUrl, jwt }), controlLauncher],
  });
  const prompt =
    messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n") +
    "\n\nAssistant:";
  return runQuery(prompt, {
    systemPrompt: system,
    mcpServers: { focus: server },
    allowedTools: [...FOCUS_TOOL_NAMES, "mcp__focus__control_computer"],
    tools: [], // no built-in file/bash tools — only the Focus API tools
    permissionMode: "bypassPermissions",
    settingSources: [], // don't load the user's CLAUDE.md / project settings
    maxTurns: 8,
  });
}

/** One-shot structured generation (enrichment). Server does strict validation. */
async function structured({ prompt }) {
  return runQuery(prompt, {
    tools: [],
    settingSources: [],
    permissionMode: "bypassPermissions",
    maxTurns: 1,
  });
}

// ---- Computer control ------------------------------------------------------

const CONTROL_SYSTEM = `You operate the user's Mac to accomplish a task, like a careful human.
You see screenshots of all displays. Work ONE step at a time: study the latest
screenshot, decide the single next action, call the matching tool, then read the
new screenshot it returns before continuing. Use \`key\` for shortcuts
(e.g. cmd+space opens Spotlight), \`type\` to enter text, \`click\` with the display
index + image-pixel coordinates. Verify each step landed before the next. When the
task is done, stop and briefly report what you did. If you get stuck or something
looks risky/destructive beyond the task, stop and explain instead of guessing.`;

const STEP_CAP = 40;
let control = { running: false, task: null, steps: [], done: false, result: null, error: null };
let controlAbort = null;

async function runControl(task) {
  control = { running: true, task, steps: [], done: false, result: null, error: null };
  controlAbort = new AbortController();
  const server = createSdkMcpServer({
    name: "computer",
    tools: computerTools((step) => control.steps.push({ ...step, at: Date.now() })),
  });
  try {
    let result = null;
    for await (const msg of query({
      prompt: `Task: ${task}\n\nBegin by taking a screenshot.`,
      options: {
        systemPrompt: CONTROL_SYSTEM,
        mcpServers: { computer: server },
        allowedTools: COMPUTER_TOOL_NAMES,
        tools: [],
        permissionMode: "bypassPermissions",
        settingSources: [],
        maxTurns: STEP_CAP,
        abortController: controlAbort,
      },
    })) {
      if (msg.type === "result") result = msg;
    }
    if (result?.subtype === "success") control.result = result.result;
    else control.error = `stopped (${result?.subtype ?? "aborted"})`;
  } catch (err) {
    control.error = String(err?.message ?? err);
  } finally {
    control.running = false;
    control.done = true;
  }
}

// ---- HTTP plumbing ---------------------------------------------------------

// The webview calls us cross-origin (tauri://… → http://127.0.0.1), and our
// Authorization header triggers a CORS preflight — answer it and tag every
// response. Safe: we bind to loopback and gate on a per-launch token.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function send(res, code, body) {
  const json = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json", ...CORS });
  res.end(json);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

const serverHttp = createServer(async (req, res) => {
  try {
    // CORS preflight from the webview — answer before anything else.
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return res.end();
    }

    // GET /health is unauthenticated (used by the host to confirm liveness);
    // everything else requires the per-launch bearer token.
    if (req.method === "GET" && req.url === "/health") {
      const version = await claudeVersion();
      return send(res, 200, { ok: Boolean(version), claudeVersion: version, loggedIn: Boolean(version) });
    }

    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      return send(res, 401, { error: "unauthorized" });
    }

    if (req.method === "POST" && req.url === "/structured") {
      const body = await readBody(req);
      return send(res, 200, { text: await structured(body) });
    }
    if (req.method === "POST" && req.url === "/assistant") {
      const body = await readBody(req);
      return send(res, 200, { reply: await assistant(body) });
    }
    if (req.method === "POST" && req.url === "/control") {
      if (control.running) return send(res, 409, { error: "a control run is already active" });
      const { task } = await readBody(req);
      if (!task) return send(res, 400, { error: "task required" });
      void runControl(task); // fire-and-forget; client polls /control/status
      return send(res, 202, { started: true });
    }
    if (req.method === "GET" && req.url === "/control/status") {
      return send(res, 200, { ...control, shots: latestShots() });
    }
    if (req.method === "POST" && req.url === "/control/stop") {
      controlAbort?.abort();
      control.running = false;
      return send(res, 200, { stopped: true });
    }
    return send(res, 404, { error: "not found" });
  } catch (err) {
    send(res, 500, { error: String(err?.message ?? err) });
  }
});

// Bind to loopback only, OS-assigned port; hand the port+token to the host.
serverHttp.listen(0, "127.0.0.1", () => {
  const { port } = serverHttp.address();
  process.stdout.write(`${JSON.stringify({ port, token: TOKEN })}\n`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => serverHttp.close(() => process.exit(0)));
}
