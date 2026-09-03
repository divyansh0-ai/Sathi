import { callTool, TOOLS } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SERVER = { name: "handoff", title: "Handoff — human-in-the-loop project board", version: "0.1.0" };
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL = SUPPORTED_PROTOCOLS[0];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Authorization",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

type Id = string | number | null;

const ok = (id: Id, result: unknown) => ({ jsonrpc: "2.0" as const, id, result });
const fail = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0" as const, id, error: { code, message } });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

async function handleRpc(msg: { id?: Id; method?: string; params?: Record<string, unknown> }) {
  const id = msg.id ?? null;

  switch (msg.method) {
    case "initialize": {
      const asked = String((msg.params as { protocolVersion?: string } | undefined)?.protocolVersion ?? "");
      return ok(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : LATEST_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions:
          "A shared project board that a human is watching live. Use say() to narrate what you are doing — it renders in the human's activity feed. Destructive or outward-facing tools (delete_task, delete_project, deploy_project) do not execute when you call them: they are parked in the human's approval queue and run only after a person clicks Approve. When a call comes back as pending, keep working on something else and poll get_approvals for the decision.",
      });
    }

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.gated
            ? `${t.description}\n\n[requires human approval — calling this queues it, it does not run]`
            : t.description,
          inputSchema: t.inputSchema,
          annotations: {
            title: t.title,
            readOnlyHint: Boolean(t.readOnly),
            destructiveHint: Boolean(t.gated),
            idempotentHint: Boolean(t.readOnly),
            openWorldHint: false,
          },
        })),
      });

    case "tools/call": {
      const params = (msg.params ?? {}) as { name?: string; arguments?: unknown };
      if (!params.name) return fail(id, -32602, "tools/call requires a tool name");

      const result = await callTool(params.name, params.arguments ?? {}, { actor: "agent", via: "mcp" });

      if (!result.ok) {
        return ok(id, {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          isError: true,
        });
      }

      const payload = result.pending_approval
        ? { pending_approval: true, approval_id: result.approval_id, message: result.message }
        : (result.data as Record<string, unknown>);

      return ok(id, {
        content: [
          {
            type: "text",
            text: result.pending_approval ? result.message! : JSON.stringify(payload, null, 2),
          },
        ],
        structuredContent: payload,
        isError: false,
      });
    }

    // Declared as unsupported in `capabilities`, but some clients probe anyway.
    case "resources/list":
      return ok(id, { resources: [] });
    case "prompts/list":
      return ok(id, { prompts: [] });

    default:
      return fail(id, -32601, `method not found: ${msg.method}`);
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(fail(null, -32700, "parse error"), 400);
  }

  const messages = Array.isArray(body) ? body : [body];
  const responses = [];

  for (const msg of messages as { id?: Id; method?: string; params?: Record<string, unknown> }[]) {
    // Notifications (no id) get acknowledged with 202 and no body, per spec.
    if (msg.id === undefined || msg.id === null) continue;
    responses.push(await handleRpc(msg));
  }

  if (responses.length === 0) return new Response(null, { status: 202, headers: CORS });
  return json(Array.isArray(body) ? responses : responses[0]);
}

/** The optional server→client SSE channel. Nothing is pushed, so decline it. */
export async function GET() {
  return new Response("this MCP server does not offer a standalone SSE stream", {
    status: 405,
    headers: { Allow: "POST, OPTIONS", ...CORS },
  });
}

export async function DELETE() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
