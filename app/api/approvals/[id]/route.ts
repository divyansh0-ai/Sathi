import { NextResponse } from "next/server";
import { decideApproval } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const decision = body?.decision === "approved" ? "approved" : body?.decision === "rejected" ? "rejected" : null;

  if (!decision) {
    return NextResponse.json({ ok: false, error: "decision must be 'approved' or 'rejected'" }, { status: 400 });
  }

  const result = await decideApproval(id, decision, body?.note ? String(body.note) : undefined);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
