# Focus MCP server

Exposes your Focus tasks, routines and memory to **Claude Code** and **Claude Desktop**
as MCP tools, so you can list, create and manage them without leaving your assistant.

It's a small local stdio process that talks to the Focus API with your account.

> **Easiest path:** in the Focus desktop app, open **Settings → Claude apps → Set up in Claude**.
> That builds this server and registers it with Claude Code (user scope) and Claude Desktop
> automatically. The manual steps below are the fallback / reference.

## Tools

| Tool | What it does |
|---|---|
| `list_tasks` | List tasks (open by default; `includeDone`, `sphere`, `query` filters). Lines end with the task id. |
| `create_task` | Capture a task in natural language — Focus's AI assigns category, due date, priority. |
| `update_task` | Update a task by id (title, status, priority, sphere, blocked, dueAt). |
| `complete_task` | Mark a task done. |
| `list_routines` / `create_routine` | Read and create recurring tasks. |
| `recall_memory` | Read what Focus has learned about you (preferences, people, patterns). |

## Build

```bash
cd apps/mcp
npm install
npm run build      # → dist/index.js
```

## Configure auth

Provide either a long-lived token **or** your username + password (the server logs in
and re-logs on expiry):

- `FOCUS_API_URL` — your Focus server (defaults to `http://localhost:3001`; set to your deployed URL otherwise).
- `FOCUS_TOKEN` — a JWT from `/auth/login`, **or**
- `FOCUS_USERNAME` + `FOCUS_PASSWORD`.

## Add to Claude Code

```bash
claude mcp add focus \
  --env FOCUS_USERNAME=you \
  --env FOCUS_PASSWORD=yourpassword \
  -- node /absolute/path/to/Focus/apps/mcp/dist/index.js
```

Then in a session: *"list my open Focus tasks"*, *"add a task: renew passport next week"*,
*"mark the Notion cleanup done"*.

## Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "focus": {
      "command": "node",
      "args": ["/absolute/path/to/Focus/apps/mcp/dist/index.js"],
      "env": {
        "FOCUS_USERNAME": "you",
        "FOCUS_PASSWORD": "yourpassword"
      }
    }
  }
}
```

Restart Claude Desktop; the Focus tools appear in the tools menu.
