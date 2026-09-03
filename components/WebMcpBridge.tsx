"use client";

import { useEffect } from "react";

export interface BridgeStatus {
  state: "checking" | "ready" | "unavailable";
  toolCount: number;
}

interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations?: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[] }>;
}

interface ModelContext {
  provideContext?: (ctx: { tools: WebMcpTool[] }) => void | Promise<void>;
  registerTool?: (tool: WebMcpTool) => { unregister?: () => void } | void;
}

interface CatalogueEntry {
  name: string;
  title: string;
  description: string;
  inputSchema: unknown;
  risk: string;
  readOnly: boolean;
  requiresApproval: boolean;
}

/**
 * Publishes the board's tools to whatever agent is driving this browser tab,
 * via the WebMCP `navigator.modelContext` surface. Each tool is a thin shim
 * over the same REST endpoints the dashboard uses, so an in-page agent and a
 * remote MCP client hit identical server-side logic — including the approval
 * gate, which no client can talk its way past.
 */
export default function WebMcpBridge({ onStatus }: { onStatus: (s: BridgeStatus) => void }) {
  useEffect(() => {
    let disposed = false;
    const handles: (() => void)[] = [];

    (async () => {
      let catalogue: CatalogueEntry[] = [];
      try {
        const res = await fetch("/api/tools", { cache: "no-store" });
        catalogue = ((await res.json()) as { tools: CatalogueEntry[] }).tools;
      } catch {
        if (!disposed) onStatus({ state: "unavailable", toolCount: 0 });
        return;
      }
      if (disposed) return;

      const invoke = async (name: string, args: Record<string, unknown>) => {
        const res = await fetch(`/api/tools/${name}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...args, _actor: "agent", _via: "webmcp" }),
        });
        const body = await res.json();
        if (body.pending_approval) return body.message as string;
        if (!body.ok) return `Error: ${body.error}`;
        return JSON.stringify(body.data, null, 2);
      };

      const tools: WebMcpTool[] = catalogue.map((t) => ({
        name: t.name,
        description: t.requiresApproval
          ? `${t.description}\n\n[requires human approval — calling this queues it, it does not run]`
          : t.description,
        inputSchema: t.inputSchema,
        annotations: {
          title: t.title,
          readOnlyHint: t.readOnly,
          destructiveHint: t.requiresApproval,
          openWorldHint: false,
        },
        execute: async (args) => ({ content: [{ type: "text", text: await invoke(t.name, args ?? {}) }] }),
      }));

      // Always available, WebMCP host or not: lets you drive the board from the
      // devtools console during a demo.
      (window as unknown as Record<string, unknown>).handoff = {
        tools: catalogue.map((t) => t.name),
        call: (name: string, args: Record<string, unknown> = {}) => invoke(name, args).then(console.log),
      };

      const ctx = (navigator as unknown as { modelContext?: ModelContext }).modelContext;

      if (ctx?.provideContext) {
        await ctx.provideContext({ tools });
        if (!disposed) onStatus({ state: "ready", toolCount: tools.length });
      } else if (ctx?.registerTool) {
        for (const tool of tools) {
          const handle = ctx.registerTool(tool);
          if (handle?.unregister) handles.push(() => handle.unregister!());
        }
        if (!disposed) onStatus({ state: "ready", toolCount: tools.length });
      } else if (!disposed) {
        onStatus({ state: "unavailable", toolCount: tools.length });
      }
    })();

    return () => {
      disposed = true;
      for (const off of handles) {
        try {
          off();
        } catch {
          /* host already tore the tool down */
        }
      }
    };
  }, [onStatus]);

  return null;
}
