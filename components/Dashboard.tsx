"use client";

import { useCallback, useEffect, useState } from "react";
import { callTool, useSnapshot } from "@/lib/client";
import type { Snapshot } from "@/lib/types";
import ProjectPane from "./ProjectPane";
import ActivityPane from "./ActivityPane";
import ApprovalPane from "./ApprovalPane";
import WebMcpBridge, { type BridgeStatus } from "./WebMcpBridge";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Dashboard() {
  const { snap, live } = useSnapshot();
  const [bridge, setBridge] = useState<BridgeStatus>({ state: "checking", toolCount: 0 });
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const project = snap?.projects.find((p) => p.id === selected) ?? snap?.projects[0] ?? null;
  const pending = snap?.approvals.filter((a) => a.status === "pending") ?? [];

  /**
   * Drives the real tool endpoints on a timer so the board can be demoed
   * without wiring up a live agent first. Same code path an agent would take.
   */
  const runDemo = useCallback(async () => {
    if (running || !project) return;
    setRunning(true);
    const projectId = project.id;
    const agent = { actor: "agent" as const, via: "webmcp" as const };

    try {
      await callTool("say", { message: "Picking up the board — reading the current state." }, agent);
      await sleep(900);

      const tasks = await callTool("get_tasks", { project_id: projectId }, agent);
      const list = (tasks.data as { tasks?: { id: string; title: string; status: string }[] } | undefined)?.tasks ?? [];
      const inFlight = list.find((t) => t.status === "doing") ?? list.find((t) => t.status === "todo");

      const created = await callTool(
        "create_task",
        {
          project_id: projectId,
          title: "Stream board updates over SSE",
          notes: "Split out of the backend task — the feed needs to move without a refresh.",
          status: "todo",
          priority: "p1",
          assignee: "agent",
        },
        agent,
      );
      await sleep(1000);

      if (inFlight) {
        await callTool(
          "move_task",
          { task_id: inFlight.id, status: "done", reason: "Landed and checked against the live board" },
          agent,
        );
        await sleep(1000);
      }

      const newId = (created.data as { id?: string } | undefined)?.id;
      if (newId) {
        await callTool("prioritize_task", { task_id: newId, priority: "p0", reason: "Blocks the demo" }, agent);
        await sleep(1000);
      }

      await callTool(
        "say",
        {
          message:
            "Build work is done. Deploying to production is irreversible and outward-facing, so I am not running it — sending it to you for approval.",
        },
        agent,
      );
      await sleep(700);

      await callTool("deploy_project", { project_id: projectId, environment: "production" }, agent);
    } finally {
      setRunning(false);
    }
  }, [project, running]);

  const resetBoard = useCallback(async () => {
    await fetch("/api/reset", { method: "POST" });
  }, []);

  return (
    <div className="flex h-screen flex-col bg-[#08090c] bg-grid text-[#e6e9ef]">
      <WebMcpBridge onStatus={setBridge} />
      <Header
        snap={snap}
        live={live}
        bridge={bridge}
        pendingCount={pending.length}
        running={running}
        onDemo={runDemo}
        onReset={resetBoard}
      />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-auto bg-[#161b25] lg:grid-cols-[300px_minmax(0,1fr)_380px] lg:overflow-hidden">
        <ProjectPane
          snap={snap}
          project={project}
          onSelectProject={setSelected}
        />
        <ActivityPane snap={snap} running={running} />
        <ApprovalPane snap={snap} />
      </main>
    </div>
  );
}

function Header({
  snap,
  live,
  bridge,
  pendingCount,
  running,
  onDemo,
  onReset,
}: {
  snap: Snapshot | null;
  live: boolean;
  bridge: BridgeStatus;
  pendingCount: number;
  running: boolean;
  onDemo: () => void;
  onReset: () => void;
}) {
  // Resolved after mount: the origin is not known during server rendering,
  // and rendering a placeholder first would fail hydration.
  const [mcpUrl, setMcpUrl] = useState("/api/mcp");
  useEffect(() => setMcpUrl(`${window.location.origin}/api/mcp`), []);

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3 border-b border-[#1c212c] bg-[#0b0d11]/90 px-5 py-3 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <div className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 text-[13px] font-bold text-white">
          H
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight">Handoff</div>
          <div className="text-[10.5px] text-[#7d8798]">human + agent, same board</div>
        </div>
      </div>

      <div className="hidden items-center gap-1.5 md:flex">
        <Chip
          tone={live ? "green" : "amber"}
          label={live ? "live" : "polling"}
          title={live ? "Streaming updates over server-sent events" : "SSE unavailable — falling back to 1.5s polling"}
        />
        <Chip
          tone={bridge.state === "ready" ? "violet" : bridge.state === "unavailable" ? "slate" : "amber"}
          label={
            bridge.state === "ready"
              ? `WebMCP · ${bridge.toolCount} tools`
              : bridge.state === "unavailable"
                ? "WebMCP · no host"
                : "WebMCP · …"
          }
          title={
            bridge.state === "ready"
              ? "Tools registered on navigator.modelContext for an in-browser agent"
              : "No WebMCP host detected in this browser. The same tools are still served over MCP at /api/mcp."
          }
        />
        <Chip tone="slate" label={`store · ${snap?.backend ?? "…"}`} title="Persistence backend in use" />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <code
          className="hidden rounded-md border border-[#1c212c] bg-[#101319] px-2 py-1 font-mono text-[10.5px] text-[#8b95a7] xl:block"
          title="Point any MCP client at this URL"
        >
          MCP · {mcpUrl}
        </code>
        {pendingCount > 0 && (
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-300 ring-1 ring-amber-500/30">
            {pendingCount} awaiting you
          </span>
        )}
        <button
          onClick={onDemo}
          disabled={running}
          className="rounded-md bg-violet-600 px-3 py-1.5 text-[11.5px] font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Agent working…" : "Simulate agent"}
        </button>
        <button
          onClick={onReset}
          className="rounded-md border border-[#1c212c] bg-[#101319] px-3 py-1.5 text-[11.5px] text-[#8b95a7] transition hover:border-[#2a3140] hover:text-[#e6e9ef]"
        >
          Reset
        </button>
      </div>
    </header>
  );
}

const TONES: Record<string, string> = {
  green: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25",
  amber: "bg-amber-500/10 text-amber-300 ring-amber-500/25",
  violet: "bg-violet-500/10 text-violet-300 ring-violet-500/25",
  slate: "bg-[#141822] text-[#7d8798] ring-[#232a36]",
};

function Chip({ tone, label, title }: { tone: keyof typeof TONES; label: string; title?: string }) {
  return (
    <span
      title={title}
      className={`rounded-full px-2 py-[3px] font-mono text-[10px] ring-1 ${TONES[tone]}`}
    >
      {label}
    </span>
  );
}
