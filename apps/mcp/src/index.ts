#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { focus, type Task } from "./api.js";

/**
 * Focus MCP server: exposes your Focus tasks, routines and memory as tools so
 * Claude Code / Claude Desktop can read and manage them. Runs as a local stdio
 * process, authenticating to the Focus API with your account (see README).
 */

const OPEN = ["inbox", "active", "waiting"] as const;
const PRIORITY_LABEL = { P1: "High", P2: "Medium", P3: "Low" } as const;

function line(t: Task): string {
  const bits = [
    PRIORITY_LABEL[t.priority],
    t.sphere,
    t.status !== "inbox" && t.status !== "active" ? t.status : null,
    t.blocked ? "blocked" : null,
    t.subtaskCount > 0 ? `${t.subtaskDone}/${t.subtaskCount} subtasks` : null,
    t.dueAt ? `due ${t.dueAt.slice(0, 10)}` : null,
    !t.enrichedAt ? "classifying…" : null,
  ].filter(Boolean);
  return `• ${t.title} — ${bits.join(", ")}  [id: ${t.id}]`;
}

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

const server = new McpServer({ name: "focus", version: "0.1.0" });

server.registerTool(
  "list_tasks",
  {
    description:
      "List the user's Focus tasks. Returns open tasks by default; set includeDone to also show completed. Optional sphere (category) and text query filters. Each line ends with the task id for use in update_task.",
    inputSchema: {
      includeDone: z.boolean().optional(),
      sphere: z.string().optional(),
      query: z.string().optional(),
    },
  },
  async ({ includeDone, sphere, query }) => {
    let tasks = await focus.listTasks();
    if (!includeDone) tasks = tasks.filter((t) => (OPEN as readonly string[]).includes(t.status));
    if (sphere) tasks = tasks.filter((t) => t.sphere === sphere.toLowerCase());
    const q = query?.trim().toLowerCase();
    if (q) tasks = tasks.filter((t) => `${t.title} ${t.rawInput}`.toLowerCase().includes(q));
    if (tasks.length === 0) return text("No matching tasks.");
    return text(`${tasks.length} task(s):\n${tasks.map(line).join("\n")}`);
  },
);

server.registerTool(
  "create_task",
  {
    description:
      "Capture a new Focus task from natural language (any language). Focus's AI auto-assigns category, due date and priority. Returns the created task.",
    inputSchema: { text: z.string().min(1).describe("The task in plain language") },
  },
  async ({ text: raw }) => text(`Created:\n${line(await focus.createTask(raw))}`),
);

server.registerTool(
  "update_task",
  {
    description:
      "Update a task by id. Any field you set is pinned against AI re-classification. Get ids from list_tasks.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      status: z.enum(["inbox", "active", "waiting", "done", "archived"]).optional(),
      priority: z.enum(["P1", "P2", "P3"]).optional(),
      sphere: z.string().optional(),
      blocked: z.boolean().optional(),
      dueAt: z.string().nullable().optional().describe("ISO datetime, or null to clear"),
    },
  },
  async ({ id, ...patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length === 0) return text("Nothing to update — provide at least one field.");
    return text(`Updated:\n${line(await focus.updateTask(id, clean))}`);
  },
);

server.registerTool(
  "complete_task",
  {
    description: "Mark a task done by id. Shortcut for update_task with status=done.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => text(`Completed:\n${line(await focus.updateTask(id, { status: "done" }))}`),
);

server.registerTool(
  "list_routines",
  { description: "List the user's recurring tasks (routines).", inputSchema: {} },
  async () => {
    const routines = await focus.listRoutines();
    if (routines.length === 0) return text("No routines yet.");
    return text(
      routines
        .map(
          (r) =>
            `• ${r.title} — every ${r.interval > 1 ? `${r.interval} ` : ""}${r.cadence}, ${r.sphere}, ${PRIORITY_LABEL[r.priority as "P1" | "P2" | "P3"] ?? r.priority}${r.active ? "" : " (paused)"}  [id: ${r.id}]`,
        )
        .join("\n"),
    );
  },
);

server.registerTool(
  "create_routine",
  {
    description: "Create a recurring task (routine). cadence: daily | weekly | monthly.",
    inputSchema: {
      title: z.string(),
      cadence: z.enum(["daily", "weekly", "monthly"]),
      sphere: z.string().optional(),
      priority: z.enum(["P1", "P2", "P3"]).optional(),
      interval: z.number().int().min(1).max(52).optional(),
      weekday: z.number().int().min(0).max(6).nullable().optional().describe("0=Sunday … 6=Saturday (weekly)"),
      dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    },
  },
  async (args) => {
    const r = await focus.createRoutine(args);
    return text(`Created routine "${r.title}" (${r.cadence})  [id: ${r.id}]`);
  },
);

server.registerTool(
  "recall_memory",
  {
    description:
      "Recall what Focus has learned about the user — preferences, people/projects, and patterns. Read-only context.",
    inputSchema: { query: z.string().optional() },
  },
  async () => {
    const records = await focus.memory();
    if (records.length === 0) return text("No memory records yet.");
    return text(records.map((r) => `• ${r.content}`).join("\n"));
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
