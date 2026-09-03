import { NextResponse } from "next/server";
import { TOOLS } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The tool catalogue, used by the in-browser WebMCP bridge and by humans with curl. */
export async function GET() {
  return NextResponse.json({
    tools: TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      risk: t.risk,
      readOnly: Boolean(t.readOnly),
      requiresApproval: Boolean(t.gated),
    })),
  });
}
