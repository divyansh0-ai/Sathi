import { NextResponse } from "next/server";
import { reset } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(await reset());
}
