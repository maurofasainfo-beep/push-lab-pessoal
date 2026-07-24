import { createCorrelationId } from "./crypto.ts";

export interface RequestContext {
  correlationId: string;
  startedAt: number;
}

export function createRequestContext(req: Request): RequestContext {
  return {
    correlationId: req.headers.get("x-correlation-id") || createCorrelationId(),
    startedAt: Date.now()
  };
}

export function allowedOrigins(): string[] {
  return (Deno.env.get("ALLOWED_ORIGIN") || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin");
  const allowed = allowedOrigins();
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0] || "";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-headers": "authorization, apikey, content-type, x-app-version, x-device-public-id, x-device-secret, x-correlation-id",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "86400",
    vary: "Origin"
  };
}

export function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  return allowedOrigins().includes(origin);
}

export function preflight(req: Request): Response {
  if (!isAllowedOrigin(req)) {
    return new Response(null, { status: 403, headers: corsHeaders(req) });
  }
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function ok<T>(req: Request, data: T, ctx: RequestContext, status = 200): Response {
  return Response.json(
    {
      success: true,
      data,
      error: null,
      meta: {
        correlation_id: ctx.correlationId,
        duration_ms: Date.now() - ctx.startedAt
      }
    },
    { status, headers: corsHeaders(req) }
  );
}

export function fail(req: Request, code: string, message: string, ctx: RequestContext, status = 400): Response {
  return Response.json(
    {
      success: false,
      data: null,
      error: {
        code,
        message,
        correlation_id: ctx.correlationId
      }
    },
    { status, headers: corsHeaders(req) }
  );
}

export async function parseJson(req: Request, maxBytes = 16_384): Promise<unknown> {
  const raw = await req.text();
  if (raw.length > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

export function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]").slice(0, 500);
}

export function logInfo(event: string, details: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: "info", event, ...details }));
}

export function logWarn(event: string, details: Record<string, unknown>): void {
  console.warn(JSON.stringify({ level: "warn", event, ...details }));
}

