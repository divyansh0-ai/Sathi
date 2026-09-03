import type { DB } from "./types";

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/**
 * The 30-second demo: one project, a handful of tasks, a short agent trail,
 * and one risky action already parked in the approval queue.
 */
export function seedDB(): DB {
  const projectId = "prj_mvp";
  const t = (
    id: string,
    title: string,
    status: DB["tasks"][number]["status"],
    priority: DB["tasks"][number]["priority"],
    position: number,
    assignee: DB["tasks"][number]["assignee"],
    notes = "",
  ) => ({
    id,
    projectId,
    title,
    notes,
    status,
    priority,
    position,
    assignee,
    createdAt: minsAgo(120),
    updatedAt: minsAgo(position),
  });

  return {
    projects: [
      {
        id: projectId,
        name: "Build MVP",
        description: "Ship the hackathon demo: dashboard, agent tools, approval gate.",
        status: "active",
        createdAt: minsAgo(180),
      },
    ],
    tasks: [
      t("tsk_ui", "UI — three-pane dashboard", "doing", "p0", 1, "agent"),
      t("tsk_backend", "Backend — task + approval API", "doing", "p0", 2, "agent"),
      t("tsk_tools", "Expose WebMCP tools to the browser agent", "todo", "p1", 3, "agent"),
      t(
        "tsk_deploy",
        "Deploy to production",
        "blocked",
        "p1",
        4,
        "human",
        "Blocked: needs a human to sign off before it goes live.",
      ),
      t("tsk_readme", "Write the README + demo script", "backlog", "p2", 5, null),
      t("tsk_schema", "Design the data model", "done", "p1", 6, "agent"),
    ],
    activity: [
      {
        id: "act_1",
        ts: minsAgo(9),
        actor: "agent",
        tool: "create_project",
        summary: 'Created project "Build MVP"',
        detail: null,
        kind: "tool_call",
        status: "ok",
        approvalId: null,
      },
      {
        id: "act_2",
        ts: minsAgo(7),
        actor: "agent",
        tool: "create_task",
        summary: "Created 6 tasks from the project brief",
        detail: null,
        kind: "tool_call",
        status: "ok",
        approvalId: null,
      },
      {
        id: "act_3",
        ts: minsAgo(5),
        actor: "agent",
        tool: "prioritize_task",
        summary: "Prioritized backlog — UI and Backend to p0",
        detail: null,
        kind: "tool_call",
        status: "ok",
        approvalId: null,
      },
      {
        id: "act_4",
        ts: minsAgo(3),
        actor: "agent",
        tool: "move_task",
        summary: 'Found a blocker — moved "Deploy to production" to blocked',
        detail: null,
        kind: "tool_call",
        status: "ok",
        approvalId: null,
      },
      {
        id: "act_5",
        ts: minsAgo(2),
        actor: "agent",
        tool: null,
        summary: "Agent says",
        detail:
          "Everything up to deployment is done. Deploying to production is irreversible, so I've sent it to you for approval instead of running it.",
        kind: "say",
        status: "ok",
        approvalId: "apr_deploy",
      },
      {
        id: "act_6",
        ts: minsAgo(2),
        actor: "agent",
        tool: "deploy_project",
        summary: "Requested approval to deploy",
        detail: null,
        kind: "approval",
        status: "pending",
        approvalId: "apr_deploy",
      },
    ],
    approvals: [
      {
        id: "apr_deploy",
        ts: minsAgo(2),
        title: "Deploy app to production",
        reason:
          "All build tasks are complete. This pushes the current build live to real users and cannot be undone from here.",
        risk: "high",
        tool: "deploy_project",
        args: { project_id: projectId, environment: "production" },
        status: "pending",
        decidedAt: null,
        note: null,
        result: null,
      },
    ],
  };
}
