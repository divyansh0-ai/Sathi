export type ID = string;

export type Actor = "agent" | "human" | "system";

export type TaskStatus = "backlog" | "todo" | "doing" | "blocked" | "done";
export type Priority = "p0" | "p1" | "p2" | "p3";
export type Risk = "low" | "medium" | "high";

export interface Project {
  id: ID;
  name: string;
  description: string;
  status: "active" | "archived";
  createdAt: string;
}

export interface Task {
  id: ID;
  projectId: ID;
  title: string;
  notes: string;
  status: TaskStatus;
  priority: Priority;
  position: number;
  assignee: Actor | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityEvent {
  id: ID;
  ts: string;
  actor: Actor;
  /** Tool name, when the event came from a tool call. */
  tool: string | null;
  /** One-line human-readable description, rendered in the center pane. */
  summary: string;
  /** Optional longer message. `say` events use this as the agent's speech bubble. */
  detail: string | null;
  kind: "tool_call" | "say" | "approval" | "error";
  status: "ok" | "pending" | "rejected" | "error";
  approvalId: ID | null;
}

export interface Approval {
  id: ID;
  ts: string;
  title: string;
  reason: string;
  risk: Risk;
  /** Tool to run on approval. `null` for a free-form ask that just needs a yes/no. */
  tool: string | null;
  args: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  decidedAt: string | null;
  note: string | null;
  result: unknown;
}

export interface DB {
  projects: Project[];
  tasks: Task[];
  activity: ActivityEvent[];
  approvals: Approval[];
}

export interface Snapshot extends DB {
  /** Bumped on every write so clients can cheaply detect staleness. */
  rev: number;
  backend: "file" | "supabase";
}

export const STATUSES: TaskStatus[] = ["backlog", "todo", "doing", "blocked", "done"];
export const PRIORITIES: Priority[] = ["p0", "p1", "p2", "p3"];
