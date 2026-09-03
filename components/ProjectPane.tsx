"use client";

import type { Priority, Project, Snapshot, Task, TaskStatus } from "@/lib/types";
import { Empty, PaneHeader } from "./ui";

const COLUMN_LABEL: Record<TaskStatus, string> = {
  doing: "In progress",
  todo: "Up next",
  blocked: "Blocked",
  backlog: "Backlog",
  done: "Done",
};

/** Work in flight reads first; finished work sinks to the bottom. */
const COLUMN_ORDER: TaskStatus[] = ["doing", "todo", "blocked", "backlog", "done"];

const PRIORITY_STYLE: Record<Priority, string> = {
  p0: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  p1: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  p2: "bg-[#141822] text-[#8b95a7] ring-[#232a36]",
  p3: "bg-[#141822] text-[#5b6474] ring-[#1c212c]",
};

const STATUS_DOT: Record<TaskStatus, string> = {
  doing: "bg-violet-400",
  todo: "bg-sky-400",
  blocked: "bg-rose-400",
  backlog: "bg-[#3b4351]",
  done: "bg-emerald-400",
};

export default function ProjectPane({
  snap,
  project,
  onSelectProject,
}: {
  snap: Snapshot | null;
  project: Project | null;
  onSelectProject: (id: string) => void;
}) {
  const tasks = snap?.tasks.filter((t) => t.projectId === project?.id) ?? [];
  const done = tasks.filter((t) => t.status === "done").length;
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  return (
    <section className="flex flex-col bg-[#0b0d11] lg:min-h-0">
      <PaneHeader label="Project" hint={`${tasks.length} tasks`} />

      <div className="flex-1 lg:min-h-0 lg:overflow-y-auto">
        {!project ? (
          <Empty>No project yet. An agent can create one with <code className="font-mono">create_project</code>.</Empty>
        ) : (
          <>
            <div className="border-b border-[#151a23] px-4 py-3.5">
              <h2 className="text-[15px] font-semibold tracking-tight">{project.name}</h2>
              <p className="mt-1 text-[11.5px] leading-relaxed text-[#7d8798]">{project.description}</p>

              <div className="mt-3 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-[#171c26]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-400 transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="font-mono text-[10px] text-[#7d8798]">{progress}%</span>
              </div>
            </div>

            <div className="px-2 py-2">
              {COLUMN_ORDER.map((status) => {
                const column = tasks
                  .filter((t) => t.status === status)
                  .sort((a, b) => a.position - b.position);
                if (column.length === 0) return null;
                return (
                  <div key={status} className="mb-1">
                    <div className="flex items-center gap-2 px-2 pb-1.5 pt-2.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
                      <span className="text-[10px] font-medium uppercase tracking-[0.09em] text-[#6b7688]">
                        {COLUMN_LABEL[status]}
                      </span>
                      <span className="font-mono text-[10px] text-[#454f60]">{column.length}</span>
                    </div>
                    {column.map((t) => (
                      <TaskRow key={t.id} task={t} />
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {(snap?.projects.length ?? 0) > 1 && (
          <div className="border-t border-[#151a23] px-2 py-2">
            <div className="px-2 pb-1.5 pt-1 text-[10px] font-medium uppercase tracking-[0.09em] text-[#6b7688]">
              All projects
            </div>
            {snap!.projects.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelectProject(p.id)}
                className={`block w-full rounded-md px-2 py-1.5 text-left text-[12px] transition ${
                  p.id === project?.id ? "bg-[#141822] text-[#e6e9ef]" : "text-[#8b95a7] hover:bg-[#101319]"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function TaskRow({ task }: { task: Task }) {
  const isDone = task.status === "done";
  return (
    <div className="rise group rounded-md px-2 py-1.5 transition hover:bg-[#101319]">
      <div className="flex items-start gap-2">
        <span
          className={`mt-[3px] shrink-0 rounded px-1 font-mono text-[9.5px] uppercase ring-1 ${PRIORITY_STYLE[task.priority]}`}
        >
          {task.priority}
        </span>
        <span
          className={`flex-1 text-[12.5px] leading-snug ${isDone ? "text-[#5b6474] line-through" : "text-[#d3d9e3]"}`}
        >
          {task.title}
        </span>
        {task.assignee && (
          <span
            title={`Owned by the ${task.assignee}`}
            className={`mt-[3px] shrink-0 rounded px-1 font-mono text-[9.5px] ${
              task.assignee === "agent" ? "bg-violet-500/10 text-violet-300" : "bg-cyan-500/10 text-cyan-300"
            }`}
          >
            {task.assignee === "agent" ? "AI" : "YOU"}
          </span>
        )}
      </div>
      {task.notes && task.status === "blocked" && (
        <p className="mt-1 pl-7 text-[11px] leading-snug text-[#7d8798]">{task.notes}</p>
      )}
    </div>
  );
}
