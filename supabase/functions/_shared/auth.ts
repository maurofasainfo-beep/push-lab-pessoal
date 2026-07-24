import type { AdminClient } from "./db.ts";
import { constantTimeEqual, sha256Hex } from "./crypto.ts";
import { fail, type RequestContext } from "./response.ts";

export interface AuthenticatedDevice {
  id: string;
  public_id: string;
  name: string;
  timezone: string;
  locale: string;
  app_version: string;
}

export async function authenticateDevice(req: Request, ctx: RequestContext, supabase: AdminClient): Promise<AuthenticatedDevice | Response> {
  const publicId = req.headers.get("x-device-public-id")?.trim() || "";
  const secret = req.headers.get("x-device-secret") || "";
  if (!publicId || !secret) return fail(req, "DEVICE_AUTH_REQUIRED", "Dispositivo nao autenticado.", ctx, 401);

  const secretHash = await sha256Hex(secret);
  const { data, error } = await supabase
    .from("devices")
    .select("id, public_id, secret_hash, name, timezone, locale, app_version, status")
    .eq("public_id", publicId)
    .maybeSingle();

  if (error) return fail(req, "DEVICE_LOOKUP_FAILED", "Falha ao validar dispositivo.", ctx, 500);
  if (!data || data.status !== "active") return fail(req, "DEVICE_NOT_FOUND", "Dispositivo inexistente ou revogado.", ctx, 401);
  if (!constantTimeEqual(data.secret_hash, secretHash)) return fail(req, "DEVICE_SECRET_INVALID", "Credencial do dispositivo invalida.", ctx, 401);

  await supabase.from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  return {
    id: data.id,
    public_id: data.public_id,
    name: data.name,
    timezone: data.timezone,
    locale: data.locale,
    app_version: data.app_version
  };
}

export async function checkRateLimit(supabase: AdminClient, key: string, action: string, maxRequests: number, windowSeconds: number): Promise<boolean> {
  const keyHash = await sha256Hex(`${key}:${action}`);
  const { data, error } = await supabase.rpc("push_lab_check_rate_limit", {
    p_key_hash: keyHash,
    p_action: action,
    p_max_requests: maxRequests,
    p_window_seconds: windowSeconds
  });
  if (error) return false;
  return Boolean(data);
}

export function clientAddress(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "unknown";
}

