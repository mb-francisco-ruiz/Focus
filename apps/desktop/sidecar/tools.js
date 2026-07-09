import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

/**
 * The Focus assistant's tools, defined as in-process MCP tools whose handlers
 * call the Focus server API with the user's JWT. The server stays the source of
 * truth (and broadcasts WS deltas to other clients); the local agent only
 * orchestrates. Read-only + narrow writes — no bulk/destructive operations, to
 * limit prompt-injection blast radius when task/email content reaches the model.
 */
export function focusTools({ baseUrl, jwt }) {
  const api = async (path, init) => {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${jwt}`,
        ...init?.headers,
      },
    });
    if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}`);
    return res.status === 204 ? null : res.json();
  };

  const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
  const compact = (t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    sphere: t.sphere,
    status: t.status,
    blocked: t.blocked,
    dueAt: t.dueAt ?? null,
  });

  return [
    tool(
      "search_tasks",
      "Search the user's tasks. Omit query for all open tasks.",
      { query: z.string().optional(), includeDone: z.boolean().optional() },
      async ({ query, includeDone }) => {
        const { tasks } = await api("/tasks");
        const q = query?.trim().toLowerCase();
        let list = tasks;
        if (!includeDone) list = list.filter((t) => ["inbox", "active", "waiting"].includes(t.status));
        if (q) list = list.filter((t) => `${t.title} ${t.rawInput}`.toLowerCase().includes(q));
        return ok(list.slice(0, 40).map(compact));
      },
    ),
    tool(
      "create_task",
      "Capture a new task from natural language. It is enriched by AI automatically.",
      { text: z.string().min(1) },
      async ({ text }) => ok(compact(await api("/tasks", { method: "POST", body: JSON.stringify({ rawInput: text }) }))),
    ),
    tool(
      "update_task",
      "Update a task by id: priority (P1/P2/P3), status (inbox/active/waiting/done/archived), sphere, blocked, or dueAt (ISO or null).",
      {
        id: z.string(),
        priority: z.enum(["P1", "P2", "P3"]).optional(),
        status: z.enum(["inbox", "active", "waiting", "done", "archived"]).optional(),
        sphere: z.string().optional(),
        blocked: z.boolean().optional(),
        dueAt: z.string().nullable().optional(),
      },
      async ({ id, ...patch }) => {
        const body = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
        return ok(compact(await api(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) })));
      },
    ),
    tool(
      "recall_memory",
      "Recall what Focus has learned about the user (preferences, entities, patterns).",
      { query: z.string().optional() },
      async () => {
        const { records } = await api("/memory");
        return ok(records.map((r) => r.content));
      },
    ),
    tool(
      "create_routine",
      "Create a recurring task. cadence: daily|weekly|monthly.",
      {
        title: z.string(),
        sphere: z.string().optional(),
        priority: z.enum(["P1", "P2", "P3"]).optional(),
        cadence: z.enum(["daily", "weekly", "monthly"]),
        interval: z.number().int().min(1).max(52).optional(),
        weekday: z.number().int().min(0).max(6).nullable().optional(),
        dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
      },
      async (args) => {
        const r = await api("/routines", { method: "POST", body: JSON.stringify(args) });
        return ok({ id: r.id, title: r.title, cadence: r.cadence });
      },
    ),
  ];
}

export const FOCUS_TOOL_NAMES = [
  "search_tasks",
  "create_task",
  "update_task",
  "recall_memory",
  "create_routine",
].map((n) => `mcp__focus__${n}`);
