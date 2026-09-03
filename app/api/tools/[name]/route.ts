import { NextResponse } from "next/server";
import { callTool, TOOLS, type Via } from "@/lib/tools";
import type { Actor } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Plain REST mirror of the MCP tools, used by the in-browser WebMCP bridge. */
export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const body = await req.json().catch(() => ({}));

  const actor = (body?._actor === "human" ? "human" : "agent") as Actor;
  const via = (body?._via === "ui" ? "ui" : "webmcp") as Via;
  const args = { ...body };
  delete args._actor;
  delete args._via;

  const result = await callTool(name, args, { actor, via });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

/** Handy for `curl` and for confirming a tool's schema in the browser. */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const def = TOOLS.find((t) => t.name === name);
  if (!def) return NextResponse.json({ error: `unknown tool "${name}"` }, { status: 404 });
  return NextResponse.json({
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema,
    risk: def.risk,
    requiresApproval: Boolean(def.gated),
  });
}
