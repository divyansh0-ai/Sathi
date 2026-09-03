"use client";

import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "./types";

export interface ToolCallResponse {
  ok: boolean;
  pending_approval?: boolean;
  approval_id?: string;
  message?: string;
  data?: unknown;
  error?: string;
}

/** Call a tool over the REST mirror. `actor` decides whether gating applies. */
export async function callTool(
  name: string,
  args: Record<string, unknown> = {},
  opts: { actor?: "agent" | "human"; via?: "webmcp" | "ui" } = {},
): Promise<ToolCallResponse> {
  const res = await fetch(`/api/tools/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...args, _actor: opts.actor ?? "agent", _via: opts.via ?? "webmcp" }),
  });
  return (await res.json()) as ToolCallResponse;
}

export async function decide(id: string, decision: "approved" | "rejected", note?: string) {
  const res = await fetch(`/api/approvals/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, note }),
  });
  return res.json();
}

/**
 * Live board state. Prefers the SSE stream; if it drops (or never opens) it
 * falls back to polling so the demo never sits on stale data.
 */
export function useSnapshot() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [live, setLive] = useState(false);
  const revRef = useRef(-1);

  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;

    const apply = (next: Snapshot) => {
      if (cancelled || next.rev < revRef.current) return;
      revRef.current = next.rev;
      setSnap(next);
    };

    const startPolling = () => {
      if (poll) return;
      poll = setInterval(async () => {
        try {
          const res = await fetch("/api/state", { cache: "no-store" });
          apply((await res.json()) as Snapshot);
        } catch {
          /* keep trying */
        }
      }, 1500);
    };

    const source = new EventSource("/api/events");
    source.onopen = () => {
      if (cancelled) return;
      setLive(true);
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
    };
    source.onmessage = (e) => apply(JSON.parse(e.data) as Snapshot);
    source.onerror = () => {
      if (cancelled) return;
      setLive(false);
      startPolling();
    };

    fetch("/api/state", { cache: "no-store" })
      .then((r) => r.json())
      .then(apply)
      .catch(() => startPolling());

    return () => {
      cancelled = true;
      source.close();
      if (poll) clearInterval(poll);
    };
  }, []);

  return { snap, live };
}

export function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
