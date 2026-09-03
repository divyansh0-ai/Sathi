# Handoff

A project board built for humans and AI agents working the same task list.

Agents do the work through tools. The risky calls — deleting things, shipping to
production — don't execute when the agent calls them. They land in a queue on
the right of the screen, and a person decides. The whole thing is live, so you
watch the agent work and it waits on you.

```
┌──────────────┬──────────────────────────┬───────────────────┐
│ PROJECT      │ AGENT ACTIVITY           │ APPROVAL QUEUE    │
│              │                          │                   │
│ Build MVP    │ ✓ Created project        │ ⚠ NEEDS YOU       │
│  ├─ UI       │ ✓ Prioritized backlog    │ Deploy to prod    │
│  ├─ Backend  │ ✓ Found a blocker        │ deploy_project()  │
│  └─ Deploy   │                          │                   │
│              │ 💬 "Deploying is         │ [Approve]         │
│              │    irreversible, so      │ [Reject]          │
│              │    I'm sending it to     │                   │
│              │    you instead."         │                   │
│              │ ⏸ Requested approval     │                   │
└──────────────┴──────────────────────────┴───────────────────┘
```

## Run it

```bash
npm install && npm run dev
```

Open http://localhost:3939. It seeds itself with a demo project — no database
setup needed.

## The 30-second demo

1. **Simulate agent** in the top right. The agent narrates in the middle pane,
   creates a task, moves one to done, re-prioritizes — the board updates live.
2. It reaches the deploy step, says why it isn't running it, and the request
   appears in the approval queue.
3. Click **Approve**. Now the deploy runs, the task flips to done, and the feed
   shows the action tagged `YOU` instead of `AI`.
4. Click **Reject** on the next one to see the other half.

The button is a scripted caller, not a fake — it hits the same HTTP endpoints an
external agent hits.

## The idea

One tool registry ([`lib/tools.ts`](lib/tools.ts)) with three front doors:

| Front door | Who uses it | Path |
| --- | --- | --- |
| **MCP over HTTP** | Claude Code, Claude Desktop, any MCP client | `POST /api/mcp` |
| **WebMCP** | an agent driving the browser tab | `navigator.modelContext` |
| **REST** | the dashboard's own buttons | `POST /api/tools/:name` |

All three funnel into one function, `callTool()`, which is where validation,
the activity log, and the approval gate live. There is no entry point that
skips the gate — an agent can't pick a different door to get around it.

### 14 tools

```
create_project   get_project      list_projects    get_tasks
create_task      update_task      move_task        prioritize_task
delete_task*     delete_project*  deploy_project*  request_approval*
get_approvals    say
```

`*` = held for a human. Calling one returns immediately with an approval id and
a note that nothing has run; the agent goes off and does something else, then
polls `get_approvals` for the verdict. On **Approve**, the server runs the
originally requested call with the originally requested arguments — the human
approves the exact thing the agent asked for, not a re-derived version of it.

`say` is the other half of the collaboration: it puts a sentence in the human's
feed, so the reasoning behind a decision is visible while it's happening rather
than buried in a transcript.

## Connect a real agent

```bash
claude mcp add --transport http handoff http://localhost:3939/api/mcp
```

Then ask it to work the board — "look at the project, split the backend task in
two, and ship it." It will get as far as shipping and stop, and you'll see why
in the middle pane.

Any MCP client works; it's a stateless Streamable HTTP server, no auth in dev.

```bash
# or just curl it
curl -s -X POST http://localhost:3939/api/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### WebMCP

On page load the browser registers the same 14 tools on
`navigator.modelContext` for any in-tab agent. The header chip shows whether a
host picked them up. With no WebMCP host present the chip reads `no host` and
everything else still works — the tools are also on `window.handoff` if you want
to drive the board from the devtools console:

```js
handoff.call("move_task", { task_id: "tsk_ui", status: "done" });
```

## Storage

Runs on a JSON file at `.data/db.json` out of the box, so it starts with no
setup. Set Supabase credentials and it switches to Postgres — same code path,
selected at startup in [`lib/store.ts`](lib/store.ts):

```bash
cp .env.example .env.local   # then fill in your project's values
```

Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor
first. Note that the Supabase backend is written but has not been run against a
live project — the file backend is what the demo above was tested on.

## Layout

```
app/
  api/mcp/route.ts            MCP Streamable HTTP server (JSON-RPC)
  api/tools/route.ts          tool catalogue, read by the WebMCP bridge
  api/tools/[name]/route.ts   REST mirror of every tool
  api/approvals/[id]/route.ts human decisions; approving executes the call
  api/events/route.ts         SSE stream — one push per state change
  api/state|reset/route.ts    snapshot, and reset to the demo seed
components/
  Dashboard.tsx               three-pane shell, header, scripted agent run
  ProjectPane.tsx             left — project and its columns
  ActivityPane.tsx            centre — live feed and agent speech
  ApprovalPane.tsx            right — the queue and recent decisions
  WebMcpBridge.tsx            registers tools on navigator.modelContext
lib/
  tools.ts                    the 14 tools + callTool(), the single gate
  store.ts                    file / Supabase backends behind one interface
  bus.ts, client.ts           SSE fan-out, and the browser's live-state hook
```

## What's real and what isn't

- Real: the tool registry, the approval gate, MCP over HTTP, live updates,
  persistence, the audit trail of who did what.
- Simulated: `deploy_project` marks deploy tasks done and returns a URL. It
  doesn't ship anything.
- Missing: authentication. Anyone who can reach the port can approve. That's
  the first thing to add if this leaves a laptop.
