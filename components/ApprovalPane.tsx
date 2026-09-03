"use client";

import { useState } from "react";
import { decide, timeAgo } from "@/lib/client";
import type { Approval, Risk, Snapshot } from "@/lib/types";
import { Empty, PaneHeader } from "./ui";

const RISK_STYLE: Record<Risk, string> = {
  high: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  medium: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  low: "bg-[#141822] text-[#8b95a7] ring-[#232a36]",
};

export default function ApprovalPane({ snap }: { snap: Snapshot | null }) {
  const approvals = snap?.approvals ?? [];
  const pending = approvals.filter((a) => a.status === "pending").slice().reverse();
  const decided = approvals.filter((a) => a.status !== "pending").slice().reverse().slice(0, 8);

  return (
    <section className="flex flex-col bg-[#0b0d11] lg:min-h-0">
      <PaneHeader
        label="Approval queue"
        hint={pending.length ? `${pending.length} waiting` : "clear"}
        accent={pending.length > 0}
      />

      <div className="flex-1 px-3 py-3 lg:min-h-0 lg:overflow-y-auto">
        {pending.length === 0 ? (
          <Empty>
            Nothing waiting on you.
            <br />
            <span className="text-[#454f60]">
              Destructive and outward-facing tool calls land here instead of running.
            </span>
          </Empty>
        ) : (
          <div className="space-y-2.5">
            {pending.map((a) => (
              <PendingCard key={a.id} approval={a} />
            ))}
          </div>
        )}

        {decided.length > 0 && (
          <div className="mt-5">
            <div className="px-1 pb-2 text-[10px] font-medium uppercase tracking-[0.09em] text-[#4b5566]">
              Recent decisions
            </div>
            <div className="space-y-px">
              {decided.map((a) => (
                <DecidedRow key={a.id} approval={a} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function PendingCard({ approval }: { approval: Approval }) {
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null);
  const [showArgs, setShowArgs] = useState(false);

  const act = async (decision: "approved" | "rejected") => {
    if (busy) return;
    setBusy(decision);
    try {
      await decide(approval.id, decision);
    } finally {
      // The SSE update removes this card; clearing guards against a failed call.
      setBusy(null);
    }
  };

  return (
    <article className="rise overflow-hidden rounded-lg border border-amber-500/25 bg-[#12121a]">
      <div className="flex items-center gap-2 border-b border-amber-500/15 bg-amber-500/[0.07] px-3 py-2">
        <span className="grid h-4 w-4 place-items-center rounded-full bg-amber-400/90 text-[10px] font-bold text-[#0b0d11] pulse-ring">
          !
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-amber-200/90">Needs you</span>
        <span className={`ml-auto rounded px-1.5 py-[1px] font-mono text-[9.5px] uppercase ring-1 ${RISK_STYLE[approval.risk]}`}>
          {approval.risk} risk
        </span>
      </div>

      <div className="px-3 py-3">
        <h3 className="text-[13.5px] font-semibold leading-snug tracking-tight text-[#eef1f6]">{approval.title}</h3>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-[#8b95a7]">{approval.reason}</p>

        {approval.tool && (
          <button
            onClick={() => setShowArgs((v) => !v)}
            className="mt-2.5 flex w-full items-center gap-1.5 rounded-md border border-[#1c212c] bg-[#0d1015] px-2 py-1.5 text-left transition hover:border-[#2a3140]"
          >
            <span className="font-mono text-[10.5px] text-violet-300">{approval.tool}()</span>
            <span className="ml-auto font-mono text-[9.5px] text-[#4b5566]">{showArgs ? "hide" : "args"}</span>
          </button>
        )}
        {showArgs && (
          <pre className="mt-1 overflow-x-auto rounded-md border border-[#1c212c] bg-[#0d1015] px-2 py-2 font-mono text-[10px] leading-relaxed text-[#7d8798]">
            {JSON.stringify(approval.args, null, 2)}
          </pre>
        )}

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => act("approved")}
            disabled={busy !== null}
            className="flex-1 rounded-md bg-emerald-500 px-3 py-2 text-[12px] font-semibold text-[#04160e] transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {busy === "approved" ? "Running…" : "Approve"}
          </button>
          <button
            onClick={() => act("rejected")}
            disabled={busy !== null}
            className="flex-1 rounded-md border border-[#2a3140] bg-[#141822] px-3 py-2 text-[12px] font-medium text-[#b9c1cf] transition hover:border-rose-500/40 hover:text-rose-200 disabled:opacity-50"
          >
            {busy === "rejected" ? "…" : "Reject"}
          </button>
        </div>

        <p className="mt-2 text-center font-mono text-[9.5px] text-[#3f4859]">
          asked {timeAgo(approval.ts)} · agent is blocked on this
        </p>
      </div>
    </article>
  );
}

function DecidedRow({ approval }: { approval: Approval }) {
  const approved = approval.status === "approved";
  return (
    <div className="flex items-start gap-2 rounded-md px-2 py-1.5 transition hover:bg-[#101319]">
      <span className={`mt-[1px] w-3 text-center font-mono text-[11px] ${approved ? "text-emerald-400" : "text-rose-300"}`}>
        {approved ? "✓" : "✕"}
      </span>
      <span className="flex-1 text-[11.5px] leading-snug text-[#7d8798]">{approval.title}</span>
      <time className="shrink-0 font-mono text-[9.5px] text-[#3f4859]">
        {approval.decidedAt ? timeAgo(approval.decidedAt) : ""}
      </time>
    </div>
  );
}
