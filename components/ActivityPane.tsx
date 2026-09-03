"use client";

import { useEffect, useRef } from "react";
import { clockTime } from "@/lib/client";
import type { ActivityEvent, Snapshot } from "@/lib/types";
import { Empty, PaneHeader } from "./ui";

export default function ActivityPane({ snap, running }: { snap: Snapshot | null; running: boolean }) {
  const events = snap?.activity ?? [];
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow the feed like a chat log, but stop fighting the user if they scroll up.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [events.length, running]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  return (
    <section className="flex flex-col bg-[#0a0c10] lg:min-h-0">
      <PaneHeader label="Agent activity" hint={`${events.length} events`} />
      <div ref={scroller} onScroll={onScroll} className="flex-1 px-4 py-3 lg:min-h-0 lg:overflow-y-auto">
        {/* justify-end keeps a short feed pinned to the bottom, chat-style. */}
        <div className="flex flex-col lg:min-h-full lg:justify-end">
          {events.length === 0 ? (
            <Empty>
              Nothing yet. Hit <span className="text-[#8b95a7]">Simulate agent</span>, or connect a real one to{" "}
              <code className="font-mono">/api/mcp</code>.
            </Empty>
          ) : (
            <div className="space-y-px">
              {events.map((e) => (
                <Row key={e.id} event={e} />
              ))}
            </div>
          )}
          {running && (
            <div className="mt-2 flex items-center gap-2 px-1 py-2 text-[11.5px] text-violet-300">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400 blink" />
              <span className="blink">agent working…</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ event }: { event: ActivityEvent }) {
  if (event.kind === "say") return <SayBubble event={event} />;

  const pending = event.status === "pending";
  const rejected = event.status === "rejected";
  const errored = event.status === "error";

  const mark = pending ? "⏸" : rejected ? "✕" : errored ? "!" : "✓";
  const markColor = pending
    ? "text-amber-300"
    : rejected
      ? "text-rose-300"
      : errored
        ? "text-rose-300"
        : "text-emerald-400";

  return (
    <div
      className={`rise group flex items-start gap-2.5 rounded-md px-2 py-[7px] transition hover:bg-[#0f131a] ${
        pending ? "border-l-2 border-amber-500/60 bg-amber-500/[0.035]" : ""
      }`}
    >
      <span className={`mt-[1px] w-3 shrink-0 text-center font-mono text-[11px] ${markColor}`}>{mark}</span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[12.5px] leading-snug text-[#d3d9e3]">{event.summary}</span>
          {event.tool && (
            <code className="rounded bg-[#12161e] px-1.5 py-[1px] font-mono text-[10px] text-[#6b7688]">
              {event.tool}
            </code>
          )}
        </div>
        {event.detail && (
          <p className="mt-1 text-[11.5px] leading-relaxed text-[#7d8798]">{event.detail}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ActorTag actor={event.actor} />
        <time className="font-mono text-[10px] text-[#3f4859]">{clockTime(event.ts)}</time>
      </div>
    </div>
  );
}

function SayBubble({ event }: { event: ActivityEvent }) {
  return (
    <div className="rise my-2 flex items-start gap-2.5 px-1">
      <div className="mt-[2px] grid h-6 w-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 text-[10px] font-bold text-white">
        AI
      </div>
      <div className="min-w-0 flex-1 rounded-lg rounded-tl-sm border border-violet-500/20 bg-violet-500/[0.06] px-3 py-2.5">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.09em] text-violet-300/80">Agent says</span>
          <time className="font-mono text-[10px] text-[#3f4859]">{clockTime(event.ts)}</time>
        </div>
        <p className="text-[12.5px] leading-relaxed text-[#d7dbe4]">{event.detail ?? event.summary}</p>
      </div>
    </div>
  );
}

function ActorTag({ actor }: { actor: ActivityEvent["actor"] }) {
  const style =
    actor === "agent"
      ? "bg-violet-500/10 text-violet-300"
      : actor === "human"
        ? "bg-cyan-500/10 text-cyan-300"
        : "bg-[#141822] text-[#5b6474]";
  const label = actor === "agent" ? "AI" : actor === "human" ? "YOU" : "SYS";
  return <span className={`rounded px-1 font-mono text-[9.5px] ${style}`}>{label}</span>;
}
