import type { Actor, ActivityEvent, Approval, DB, Priority, Risk, Task, TaskStatus } from "./types";
import { PRIORITIES, STATUSES } from "./types";
import { newId, nowISO } from "./ids";
import { mutate, snapshot } from "./store";
import { validate, ToolInputError, type JSONSchema } from "./validate";

export type Via = "mcp" | "webmcp" | "ui" | "approval";

export interface ToolCtx {
  actor: Actor;
  via: Via;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Args = Record<string, any>;

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: JSONSchema;
  risk: Risk;
  /** Read-only tools skip the activity log — they would drown the feed. */
  readOnly?: boolean;
  /** Agent calls to a gated tool are parked in the human approval queue. */
  gated?: boolean;
  approval?: (db: DB, args: Args) => { title: string; reason: string };
  /** Runs inside the store mutation; mutate `db` in place and return a result. */
  run: (db: DB, args: Args, ctx: ToolCtx) => unknown;
  /** One-line entry for the agent activity feed. */
  summary: (args: Args, result: any) => string;
}

/* --------------------------------------------------------------- helpers */

const str = (description: string, extra: Record<string, unknown> = {}) =>
  ({ type: "string" as const, description, ...extra });

const findProject = (db: DB, id: string) => {
  const p = db.projects.find((x) => x.id === id);
  if (!p) throw new ToolInputError(`no project with id "${id}"`);
  return p;
};

const findTask = (db: DB, id: string) => {
  const t = db.tasks.find((x) => x.id === id);
  if (!t) throw new ToolInputError(`no task with id "${id}"`);
  return t;
};

const defaultProject = (db: DB, id?: string) => {
  if (id) return findProject(db, id);
  const p = db.projects.find((x) => x.status === "active") ?? db.projects[0];
  if (!p) throw new ToolInputError("no projects exist yet — call create_project first");
  return p;
};

const publicTask = (t: Task) => ({
  id: t.id,
  project_id: t.projectId,
  title: t.title,
  notes: t.notes,
  status: t.status,
  priority: t.priority,
  assignee: t.assignee,
  updated_at: t.updatedAt,
});

const nextPosition = (db: DB, projectId: string, status: TaskStatus) =>
  Math.max(0, ...db.tasks.filter((t) => t.projectId === projectId && t.status === status).map((t) => t.position)) + 1;

/* ----------------------------------------------------------------- tools */

export const TOOLS: ToolDef[] = [
  {
    name: "create_project",
    title: "Create project",
    description: "Create a new project. Returns the project, including the id the task tools need.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        name: str("Short project name, e.g. 'Build MVP'."),
        description: str("One or two sentences on what done looks like.", { default: "" }),
      },
      required: ["name"],
    },
    run(db, args) {
      const p = {
        id: newId("prj"),
        name: String(args.name),
        description: String(args.description ?? ""),
        status: "active" as const,
        createdAt: nowISO(),
      };
      db.projects.push(p);
      return { id: p.id, name: p.name, description: p.description, status: p.status };
    },
    summary: (_a, r) => `Created project "${r.name}"`,
  },

  {
    name: "get_project",
    title: "Get project",
    description: "Read one project with its task counts by status. Omit project_id for the active project.",
    risk: "low",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { project_id: str("Project id. Defaults to the active project.") },
    },
    run(db, args) {
      const p = defaultProject(db, args.project_id);
      const tasks = db.tasks.filter((t) => t.projectId === p.id);
      const counts = Object.fromEntries(STATUSES.map((s) => [s, tasks.filter((t) => t.status === s).length]));
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        task_count: tasks.length,
        counts,
        open_approvals: db.approvals.filter((a) => a.status === "pending").length,
      };
    },
    summary: (_a, r) => `Read project "${r.name}"`,
  },

  {
    name: "list_projects",
    title: "List projects",
    description: "List every project with its id, name and task count.",
    risk: "low",
    readOnly: true,
    inputSchema: { type: "object", properties: {} },
    run(db) {
      return {
        projects: db.projects.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          task_count: db.tasks.filter((t) => t.projectId === p.id).length,
        })),
      };
    },
    summary: (_a, r) => `Listed ${r.projects.length} project(s)`,
  },

  {
    name: "get_tasks",
    title: "Get tasks",
    description:
      "List tasks in priority order. Filter by project, status or assignee. Call this before updating anything so you are working with real task ids.",
    risk: "low",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        project_id: str("Defaults to the active project."),
        status: str("Only tasks in this column.", { enum: STATUSES }),
        assignee: str("Only tasks owned by this actor.", { enum: ["human", "agent"] }),
      },
    },
    run(db, args) {
      const p = defaultProject(db, args.project_id);
      let tasks = db.tasks.filter((t) => t.projectId === p.id);
      if (args.status) tasks = tasks.filter((t) => t.status === args.status);
      if (args.assignee) tasks = tasks.filter((t) => t.assignee === args.assignee);
      tasks = tasks.sort(
        (a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || a.position - b.position,
      );
      return { project_id: p.id, count: tasks.length, tasks: tasks.map(publicTask) };
    },
    summary: (_a, r) => `Read ${r.count} task(s)`,
  },

  {
    name: "create_task",
    title: "Create task",
    description: "Add a task to a project.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        title: str("What needs doing, as a short imperative phrase."),
        project_id: str("Defaults to the active project."),
        notes: str("Extra context for whoever picks this up.", { default: "" }),
        status: str("Starting column.", { enum: STATUSES, default: "backlog" }),
        priority: str("p0 is most urgent.", { enum: PRIORITIES, default: "p2" }),
        assignee: str("Who owns it.", { enum: ["human", "agent"] }),
      },
      required: ["title"],
    },
    run(db, args) {
      const p = defaultProject(db, args.project_id);
      const status = (args.status ?? "backlog") as TaskStatus;
      const t: Task = {
        id: newId("tsk"),
        projectId: p.id,
        title: String(args.title),
        notes: String(args.notes ?? ""),
        status,
        priority: (args.priority ?? "p2") as Priority,
        position: nextPosition(db, p.id, status),
        assignee: (args.assignee ?? null) as Actor | null,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      };
      db.tasks.push(t);
      return publicTask(t);
    },
    summary: (_a, r) => `Created task "${r.title}"`,
  },

  {
    name: "update_task",
    title: "Update task",
    description: "Change a task's title, notes, assignee, status or priority. Only the fields you pass are touched.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        task_id: str("Id from get_tasks."),
        title: str("New title."),
        notes: str("New notes."),
        status: str("New column.", { enum: STATUSES }),
        priority: str("New priority.", { enum: PRIORITIES }),
        assignee: str("New owner. Pass 'none' to unassign.", { enum: ["human", "agent", "none"] }),
      },
      required: ["task_id"],
    },
    run(db, args) {
      const t = findTask(db, args.task_id);
      if (args.title !== undefined) t.title = String(args.title);
      if (args.notes !== undefined) t.notes = String(args.notes);
      if (args.status !== undefined) t.status = args.status as TaskStatus;
      if (args.priority !== undefined) t.priority = args.priority as Priority;
      if (args.assignee !== undefined) t.assignee = args.assignee === "none" ? null : (args.assignee as Actor);
      t.updatedAt = nowISO();
      return publicTask(t);
    },
    summary: (_a, r) => `Updated "${r.title}"`,
  },

  {
    name: "move_task",
    title: "Move task",
    description:
      "Move a task to another column, optionally with a reason that shows up in the activity feed. Use this when work starts, finishes, or gets blocked.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        task_id: str("Id from get_tasks."),
        status: str("Destination column.", { enum: STATUSES }),
        reason: str("Why it moved. Shown to the human.", { default: "" }),
      },
      required: ["task_id", "status"],
    },
    run(db, args) {
      const t = findTask(db, args.task_id);
      const from = t.status;
      t.status = args.status as TaskStatus;
      t.position = nextPosition(db, t.projectId, t.status);
      if (args.reason) t.notes = String(args.reason);
      t.updatedAt = nowISO();
      return { ...publicTask(t), from, to: t.status, reason: args.reason ?? "" };
    },
    summary: (a, r) => `Moved "${r.title}" ${r.from} → ${r.to}${a.reason ? ` — ${a.reason}` : ""}`,
  },

  {
    name: "prioritize_task",
    title: "Prioritize task",
    description: "Set a task's priority (p0 highest, p3 lowest).",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        task_id: str("Id from get_tasks."),
        priority: str("New priority.", { enum: PRIORITIES }),
        reason: str("Why, in a few words.", { default: "" }),
      },
      required: ["task_id", "priority"],
    },
    run(db, args) {
      const t = findTask(db, args.task_id);
      const from = t.priority;
      t.priority = args.priority as Priority;
      t.updatedAt = nowISO();
      return { ...publicTask(t), from, to: t.priority, reason: args.reason ?? "" };
    },
    summary: (a, r) => `Prioritized "${r.title}" ${r.from} → ${r.to}${a.reason ? ` — ${a.reason}` : ""}`,
  },

  {
    name: "delete_task",
    title: "Delete task",
    description:
      "Permanently delete a task. Destructive: an agent calling this parks it in the human approval queue instead of deleting.",
    risk: "medium",
    gated: true,
    inputSchema: {
      type: "object",
      properties: { task_id: str("Id from get_tasks."), reason: str("Why it should go.", { default: "" }) },
      required: ["task_id"],
    },
    approval: (db, args) => {
      const t = db.tasks.find((x) => x.id === args.task_id);
      return {
        title: `Delete task "${t?.title ?? args.task_id}"`,
        reason: String(args.reason || "The agent believes this task is no longer needed. Deletion cannot be undone."),
      };
    },
    run(db, args) {
      const t = findTask(db, args.task_id);
      db.tasks = db.tasks.filter((x) => x.id !== t.id);
      return { deleted: true, id: t.id, title: t.title };
    },
    summary: (_a, r) => `Deleted task "${r.title}"`,
  },

  {
    name: "delete_project",
    title: "Delete project",
    description: "Permanently delete a project and all of its tasks. Always requires human approval.",
    risk: "high",
    gated: true,
    inputSchema: {
      type: "object",
      properties: { project_id: str("Id from list_projects."), reason: str("Why.", { default: "" }) },
      required: ["project_id"],
    },
    approval: (db, args) => {
      const p = db.projects.find((x) => x.id === args.project_id);
      const n = db.tasks.filter((t) => t.projectId === args.project_id).length;
      return {
        title: `Delete project "${p?.name ?? args.project_id}"`,
        reason: String(args.reason || `This removes the project and all ${n} of its tasks. It cannot be undone.`),
      };
    },
    run(db, args) {
      const p = findProject(db, args.project_id);
      const removed = db.tasks.filter((t) => t.projectId === p.id).length;
      db.tasks = db.tasks.filter((t) => t.projectId !== p.id);
      db.projects = db.projects.filter((x) => x.id !== p.id);
      return { deleted: true, id: p.id, name: p.name, tasks_removed: removed };
    },
    summary: (_a, r) => `Deleted project "${r.name}" and ${r.tasks_removed} task(s)`,
  },

  {
    name: "deploy_project",
    title: "Deploy project",
    description:
      "Ship the project to an environment. Simulated for this demo: it marks deploy tasks done and returns a URL. Always requires human approval.",
    risk: "high",
    gated: true,
    inputSchema: {
      type: "object",
      properties: {
        project_id: str("Defaults to the active project."),
        environment: str("Target environment.", { enum: ["staging", "production"], default: "production" }),
        reason: str("What is being shipped.", { default: "" }),
      },
    },
    approval: (db, args) => {
      const p = db.projects.find((x) => x.id === args.project_id) ?? db.projects[0];
      const env = String(args.environment ?? "production");
      const open = db.tasks.filter((t) => t.projectId === p?.id && t.status !== "done").length;
      return {
        title: `Deploy "${p?.name ?? "project"}" to ${env}`,
        reason: String(
          args.reason ||
            `Pushes the current build to ${env}. ${open} task(s) are still open. This is outward-facing and cannot be undone from here.`,
        ),
      };
    },
    run(db, args) {
      const p = defaultProject(db, args.project_id);
      const env = String(args.environment ?? "production");
      for (const t of db.tasks) {
        if (t.projectId === p.id && /deploy/i.test(t.title)) {
          t.status = "done";
          t.updatedAt = nowISO();
        }
      }
      const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      return {
        deployed: true,
        simulated: true,
        project: p.name,
        environment: env,
        url: `https://${slug}.${env === "production" ? "app" : "staging"}.example.com`,
      };
    },
    summary: (_a, r) => `Deployed ${r.project} to ${r.environment} (simulated)`,
  },

  {
    name: "request_approval",
    title: "Request approval",
    description:
      "Ask the human for a yes/no on something outside these tools — a spend, an email, a schema change. Returns immediately with an approval id; poll get_approvals for the decision.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        title: str("The decision, in one line."),
        reason: str("Why you are asking and what happens either way."),
        risk: str("How costly a wrong yes would be.", { enum: ["low", "medium", "high"], default: "medium" }),
      },
      required: ["title", "reason"],
    },
    run() {
      // Always intercepted by callTool's gating path — never reached.
      return {};
    },
    summary: (a) => `Asked for approval: ${a.title}`,
  },

  {
    name: "get_approvals",
    title: "Get approvals",
    description:
      "Check the approval queue, including decisions already made. Use this to find out whether a parked action was approved or rejected.",
    risk: "low",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { status: str("Filter by decision state.", { enum: ["pending", "approved", "rejected"] }) },
    },
    run(db, args) {
      const list = db.approvals.filter((a) => !args.status || a.status === args.status).slice().reverse();
      return {
        count: list.length,
        approvals: list.map((a) => ({
          id: a.id,
          title: a.title,
          risk: a.risk,
          tool: a.tool,
          status: a.status,
          note: a.note,
          decided_at: a.decidedAt,
          result: a.result,
        })),
      };
    },
    summary: (_a, r) => `Checked approvals (${r.count})`,
  },

  {
    name: "say",
    title: "Say",
    description:
      "Post a short message into the activity feed so the human can follow your reasoning. Use it to explain a decision, flag a blocker, or hand off.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: { message: str("What you want the human to read.") },
      required: ["message"],
    },
    run(_db, args) {
      return { said: String(args.message) };
    },
    summary: () => "Agent says",
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/* ----------------------------------------------------------- the gateway */

export interface ToolResult {
  ok: boolean;
  /** Set when the call was parked for a human instead of executed. */
  pending_approval?: boolean;
  approval_id?: string;
  message?: string;
  data?: unknown;
  error?: string;
}

function pushActivity(db: DB, e: Omit<ActivityEvent, "id" | "ts">) {
  db.activity.push({ id: newId("act"), ts: nowISO(), ...e });
}

/**
 * Every route into the system goes through here: the MCP server, the WebMCP
 * bridge, and the dashboard's own buttons. Gating, logging and validation
 * therefore cannot be bypassed by picking a different entry point.
 */
export async function callTool(name: string, rawArgs: unknown, ctx: ToolCtx): Promise<ToolResult> {
  const def = TOOLS_BY_NAME.get(name);
  if (!def) return { ok: false, error: `unknown tool "${name}"` };

  let args: Args;
  try {
    args = validate(def.inputSchema, rawArgs ?? {});
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const needsApproval = (def.gated || name === "request_approval") && ctx.via !== "approval" && ctx.actor !== "human";

  if (needsApproval) {
    try {
      const { result } = await mutate((db) => {
        const meta =
          name === "request_approval"
            ? { title: String(args.title), reason: String(args.reason) }
            : def.approval!(db, args);

        const approval: Approval = {
          id: newId("apr"),
          ts: nowISO(),
          title: meta.title,
          reason: meta.reason,
          risk: (name === "request_approval" ? (args.risk ?? "medium") : def.risk) as Risk,
          tool: name === "request_approval" ? null : name,
          args,
          status: "pending",
          decidedAt: null,
          note: null,
          result: null,
        };
        db.approvals.push(approval);

        pushActivity(db, {
          actor: ctx.actor,
          tool: name,
          summary: `Requested approval — ${meta.title}`,
          detail: meta.reason,
          kind: "approval",
          status: "pending",
          approvalId: approval.id,
        });
        return approval;
      });

      return {
        ok: true,
        pending_approval: true,
        approval_id: result.id,
        message: `Held for human approval: "${result.title}". Nothing has run yet. Poll get_approvals to see the decision.`,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  try {
    const { result } = await mutate((db) => {
      const data = def.run(db, args, ctx);
      if (!def.readOnly) {
        pushActivity(db, {
          actor: ctx.actor,
          tool: name,
          summary: def.summary(args, data),
          detail: name === "say" ? String(args.message) : null,
          kind: name === "say" ? "say" : "tool_call",
          status: "ok",
          approvalId: null,
        });
      }
      return data;
    });
    return { ok: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!(err instanceof ToolInputError)) {
      await mutate((db) =>
        pushActivity(db, {
          actor: ctx.actor,
          tool: name,
          summary: `${name} failed — ${message}`,
          detail: null,
          kind: "error",
          status: "error",
          approvalId: null,
        }),
      );
    }
    return { ok: false, error: message };
  }
}

/** Human decision on a queued item. Approving runs the parked tool for real. */
export async function decideApproval(id: string, decision: "approved" | "rejected", note?: string) {
  const snap = await snapshot();
  const approval = snap.approvals.find((a) => a.id === id);
  if (!approval) return { ok: false, error: `no approval with id "${id}"` };
  if (approval.status !== "pending") return { ok: false, error: `approval "${id}" was already ${approval.status}` };

  if (decision === "rejected") {
    await mutate((db) => {
      const a = db.approvals.find((x) => x.id === id)!;
      a.status = "rejected";
      a.decidedAt = nowISO();
      a.note = note ?? null;
      const linked = db.activity.find((e) => e.approvalId === id && e.kind === "approval");
      if (linked) linked.status = "rejected";
      pushActivity(db, {
        actor: "human",
        tool: a.tool,
        summary: `Rejected — ${a.title}`,
        detail: note ?? null,
        kind: "approval",
        status: "rejected",
        approvalId: id,
      });
    });
    return { ok: true, status: "rejected" as const };
  }

  let result: unknown = { acknowledged: true };
  if (approval.tool) {
    const run = await callTool(approval.tool, approval.args, { actor: "human", via: "approval" });
    if (!run.ok) return { ok: false, error: run.error };
    result = run.data;
  }

  await mutate((db) => {
    const a = db.approvals.find((x) => x.id === id)!;
    a.status = "approved";
    a.decidedAt = nowISO();
    a.note = note ?? null;
    a.result = result;
    const linked = db.activity.find((e) => e.approvalId === id && e.kind === "approval");
    if (linked) linked.status = "ok";
    pushActivity(db, {
      actor: "human",
      tool: a.tool,
      summary: `Approved — ${a.title}`,
      detail: note ?? null,
      kind: "approval",
      status: "ok",
      approvalId: id,
    });
  });

  return { ok: true, status: "approved" as const, result };
}
