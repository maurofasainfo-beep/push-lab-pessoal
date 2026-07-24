import { authenticateDevice, checkRateLimit, clientAddress, type AuthenticatedDevice } from "./auth.ts";
import { createPublicDeviceId, sha256Hex } from "./crypto.ts";
import { adminClient, type AdminClient } from "./db.ts";
import { fail, isAllowedOrigin, logInfo, logWarn, ok, parseJson, preflight, sanitizeErrorMessage, type RequestContext, createRequestContext } from "./response.ts";
import {
  idSchema,
  listNotificationsSchema,
  notificationInputSchema,
  registerDeviceSchema,
  registerSubscriptionSchema,
  revokeDeviceSchema,
  sendTestSchema,
  updateDeviceSchema,
  updateNotificationSchema
} from "./validation.ts";
import { processDueNotifications } from "./webpush.ts";

type Handler = (req: Request, ctx: RequestContext, supabase: AdminClient) => Promise<Response>;
type AuthHandler = (req: Request, ctx: RequestContext, supabase: AdminClient, device: AuthenticatedDevice) => Promise<Response>;

function requireMethod(req: Request, ctx: RequestContext, method: "GET" | "POST"): Response | null {
  if (req.method !== method) return fail(req, "METHOD_NOT_ALLOWED", "Metodo HTTP nao permitido.", ctx, 405);
  return null;
}

function requireOrigin(req: Request, ctx: RequestContext): Response | null {
  if (!isAllowedOrigin(req)) return fail(req, "ORIGIN_NOT_ALLOWED", "Origem nao autorizada.", ctx, 403);
  return null;
}

async function withDevice(req: Request, ctx: RequestContext, supabase: AdminClient, action: string, handler: AuthHandler): Promise<Response> {
  const originError = requireOrigin(req, ctx);
  if (originError) return originError;
  const device = await authenticateDevice(req, ctx, supabase);
  if (device instanceof Response) return device;

  const withinLimit = await checkRateLimit(supabase, device.public_id, action, action === "create-notification" ? 30 : 60, 60);
  if (!withinLimit) return fail(req, "RATE_LIMITED", "Limite temporario atingido. Tente novamente em instantes.", ctx, 429);

  return handler(req, ctx, supabase, device);
}

async function handleRegisterDevice(req: Request, ctx: RequestContext, supabase: AdminClient): Promise<Response> {
  const methodError = requireMethod(req, ctx, "POST");
  if (methodError) return methodError;
  const originError = requireOrigin(req, ctx);
  if (originError) return originError;

  const ipKey = clientAddress(req);
  const withinLimit = await checkRateLimit(supabase, ipKey, "register-device", 12, 60);
  if (!withinLimit) return fail(req, "RATE_LIMITED", "Muitas tentativas de registro.", ctx, 429);

  const payload = registerDeviceSchema.parse(await parseJson(req));
  const publicId = createPublicDeviceId();
  const secretHash = await sha256Hex(payload.device_secret);

  const { data, error } = await supabase
    .from("devices")
    .insert({
      public_id: publicId,
      secret_hash: secretHash,
      name: payload.name,
      timezone: payload.timezone,
      locale: payload.locale,
      user_agent: payload.user_agent || null,
      app_version: payload.app_version,
      status: "active",
      notifications_permission: payload.notifications_permission,
      last_seen_at: new Date().toISOString()
    })
    .select("public_id, name")
    .single();

  if (error) return fail(req, "DEVICE_REGISTER_FAILED", "Nao foi possivel registrar o dispositivo.", ctx, 500);

  await supabase.from("device_events").insert({ device_id: null, event_type: "installation", event_data: { public_id: data.public_id } });
  return ok(req, data, ctx, 201);
}

async function handleUpdateDevice(req: Request, ctx: RequestContext, supabase: AdminClient, device: AuthenticatedDevice): Promise<Response> {
  const methodError = requireMethod(req, ctx, "POST");
  if (methodError) return methodError;
  const payload = updateDeviceSchema.parse(await parseJson(req));
  const { data, error } = await supabase.from("devices").update({ name: payload.name }).eq("id", device.id).select("name").single();
  if (error) return fail(req, "DEVICE_UPDATE_FAILED", "Nao foi possivel atualizar o dispositivo.", ctx, 500);
  return ok(req, data, ctx);
}

async function handleRegisterSubscription(req: Request, ctx: RequestContext, supabase: AdminClient, device: AuthenticatedDevice): Promise<Response> {
  const methodError = requireMethod(req, ctx, "POST");
  if (methodError) return methodError;
  const payload = registerSubscriptionSchema.parse(await parseJson(req));
  const endpointHash = await sha256Hex(payload.subscription.endpoint);

  const { data: existing, error: existingError } = await supabase
    .from("push_subscriptions")
    .select("id, device_id")
    .eq("endpoint_hash", endpointHash)
    .maybeSingle();

  if (existingError) return fail(req, "SUBSCRIPTION_LOOKUP_FAILED", "Falha ao verificar inscricao.", ctx, 500);
  if (existing && existing.device_id !== device.id) return fail(req, "SUBSCRIPTION_CONFLICT", "Esta inscricao ja pertence a outro dispositivo.", ctx, 409);

  const expiresAt = payload.subscription.expirationTime ? new Date(payload.subscription.expirationTime).toISOString() : null;
  const record = {
    device_id: device.id,
    endpoint: payload.subscription.endpoint,
    endpoint_hash: endpointHash,
    p256dh: payload.subscription.keys.p256dh,
    auth: payload.subscription.keys.auth,
    status: "active",
    expires_at: expiresAt,
    revoked_at: null
  };

  const query = existing
    ? supabase.from("push_subscriptions").update(record).eq("id", existing.id)
    : supabase.from("push_subscriptions").insert(record);
  const { error } = await query;
  if (error) return fail(req, "SUBSCRIPTION_REGISTER_FAILED", "Nao foi possivel salvar a inscricao Web Push.", ctx, 500);

  await supabase.from("devices").update({ notifications_permission: payload.notifications_permission }).eq("id", device.id);
  await supabase.from("device_events").insert({ device_id: device.id, event_type: existing ? "subscription_updated" : "subscription_created" });
  return ok(req, { status: "active" }, ctx, existing ? 200 : 201);
}

async function insertNotification(
  req: Request,
  ctx: RequestContext,
  supabase: AdminClient,
  device: AuthenticatedDevice,
  payload: ReturnType<typeof notificationInputSchema.parse>
): Promise<Response> {
  const scheduledAt = payload.delivery_type === "immediate" ? new Date().toISOString() : payload.scheduled_at;
  if (payload.delivery_type === "scheduled" && new Date(scheduledAt).getTime() <= Date.now() + 30_000) {
    return fail(req, "INVALID_SCHEDULE_DATE", "A data deve estar no futuro.", ctx, 422);
  }

  const { data, error } = await supabase
    .from("notifications")
    .insert({
      device_id: device.id,
      title: payload.title,
      body: payload.body,
      image_url: payload.image_url || null,
      icon_url: payload.icon_url || null,
      badge_url: payload.badge_url || null,
      target_url: payload.target_url || "/",
      tag: payload.tag || null,
      custom_data: payload.custom_data,
      delivery_type: payload.delivery_type,
      scheduled_at: scheduledAt,
      status: "scheduled"
    })
    .select("id, status")
    .single();

  if (error) return fail(req, "NOTIFICATION_CREATE_FAILED", "Nao foi possivel criar a notificacao.", ctx, 500);

  let processing = null;
  if (payload.delivery_type === "immediate") {
    processing = await processDueNotifications(supabase, { batchSize: 1, notificationId: data.id });
  }

  return ok(req, { notification: data, processing }, ctx, 201);
}

async function handleCreateNotification(req: Request, ctx: RequestContext, supabase: AdminClient, device: AuthenticatedDevice): Promise<Response> {
  const methodError = requireMethod(req, ctx, "POST");
  if (methodError) return methodError;
  const payload = notificationInputSchema.parse(await parseJson(req));
  return insertNotification(req, ctx, supabase, device, payload);
}

async function handleUpdateNotification(req: Request, ctx: RequestContext, supabase: AdminClient, device: AuthenticatedDevice): Promise<Response> {
  const methodError = requireMethod(req, ctx, "POST");
  if (methodError) return methodError;
  const payload = updateNotificationSchema.parse(await parseJson(req));
  if (payload.delivery_type === "scheduled" && new Date(payload.scheduled_at).getTime() <= Date.now() + 30_000) {
    return fail(req, "INVALID_SCHEDULE_DATE", "A data deve estar no futuro.", ctx, 422);
  }

  const { data: existing, error: existingError } = await supabase
    .from("notifications")
    .select("id, status")
    .eq("id", payload.id)
    .eq("device_id", device.id)
    .maybeSingle();
  if (existingError) return fail(req, "NOTIFICATION_LOOKUP_FAILED", "Falha ao localizar notificacao.", ctx, 500);
  if (!existing) return fail(req, "NOTIFICATION_NOT_FOUND", "Notificacao nao encontrada.", ctx, 404);
  if (!["draft", "scheduled", "failed", "partially_failed"].includes(existing.status)) {
    return fail(req, "NOTIFICATION_LOCKED", "Esta notificacao nao pode mais ser editada.", ctx, 409);
  }

  const { error } = await supabase
    .from("notifications")
    .update({
      title: payload.title,
      body: payload.body,
      image_url: payload.image_url || null,
      icon_url: payload.icon_url || null,
      badge_url: payload.badge_url || null,
      target_url: payload.target_url || "/",
      tag: payload.tag || null,
      custom_data: payload.custom_data,
      delivery_type: payload.delivery_type,
      scheduled_at: payload.delivery_type === "immediate" ? new Date().toISOString() : payload.scheduled_at,
      status: "scheduled",
      cancelled_at: null,
      sent_at: null,
      next_retry_at: null,
      last_error_code: null
    })
    .eq("id", payload.id)
    .eq("device_id", device.id);

  if (error) return fail(req, "NOTIFICATION_UPDATE_FAILED", "Nao foi possivel atualizar a notificacao.", ctx, 500);

  let processing = null;
  if (payload.delivery_type === "immediate") {
    processing = await processDueNotifications(supabase, { batchSize: 1, notificationId: payload.id });
  }
  return ok(req, { id: payload.id, processing }, ctx);
}

async function handleCancelNotification(req: Request, ctx: RequestContext, supabase: AdminClient, device: AuthenticatedDevice): Promise<Response> {
  const methodError = requireMethod(req, ctx, "POST");
  if (methodError) return methodError;
  const payload = idSchema.parse(await parseJson(req));
  const { data, error } = await supabase
    .from("notifications")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      processing_started_at: null,
      next_retry_at: null
    })
    .eq("id", payload.id)
    .eq("device_id", device.id)
    .in("status", ["draft", "scheduled", "failed", "partially_failed"])
    .select("id, status")
    .maybeSingle();

  if (error) return fail(req, "NOTIFICATION_CANCEL_FAILED", "Nao foi possivel cancelar.", ctx, 500);
  if (!data) return fail(req, "NOTIFICATION_NOT_CANCELLABLE", "Notificacao inexistente ou nao cancelavel.", ctx, 409);
  return ok(req, data, ctx);
}

async function handleListNotifications(req: Request, ctx: RequestContext, supabase: AdminClient, device: AuthenticatedDevice): Promise<Response> {
  const methodError = requireMethod(req, ctx, "POST");
  if (methodError) return methodError;
  const payload = listNotificationsSchema.parse(await parseJson(req));
  let query = supabase
    .from("notifications")
    .select("id,title,body,image_url,icon_url,badge_url,target_url,tag,custom_data,delivery_type,scheduled_at,status,created_at,updated_at,cancelled_at,sent_at,attempt_count,max_attempts,last_error_code")
    .eq("device_id", device.id)
    .order("scheduled_at", { ascending: false })
    .limit(payload.limit);
  if (payload.status) query = query.eq("status", payload.status);
  const { data, error } = await query;
  if (error) return fail(req, "NOTIFICATION_LIST_FAILED", "Nao foi possivel listar notificacoes.", ctx, 500);
  return ok(req, { notifications: data || [] }, ctx);
}

async function handleGetNotification(req: Request, ctx: RequestContext, supabase: AdminClient, device: AuthenticatedDevice): Promise<Response> {
  const methodError = requireMethod(req, ctx, "POST");
  if (methodError) return methodError;
  const payload = idSchema.parse(await parseJson(req));
  const { data: notification, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("id", payload.id)
    .eq("device_id", device.id)
    .maybeSingle();
  if (error) return fail(req, "NOTIFICATION_LOOKUP_FAILED", "Falha ao consultar notificacao.", ctx, 500);
  if (!notification) return fail(req, "NOTIFICATION_NOT_FOUND", "Notificacao nao encontrada.", ctx, 404);
  const { data: deliveries } = await supabase.from("notification_deliveries").select("*").eq("notification_id", payload.id).order("attempted_at", { ascending: false });
  return ok(req, { notification, deliveries: deliveries || [] }, ctx);
}

async function handleSendTest(req: Request, ctx: RequestContext, supabase: AdminClient, device: AuthenticatedDevice): Promise<Response> {
  const methodError = requireMethod(req, ctx, "POST");
  if (methodError) return methodError;
  const payload = sendTestSchema.parse(await parseJson(req));
  const notificationPayload = notificationInputSchema.parse({
    title: payload.title,
    body: payload.body,
    image_url: null,
    icon_url: null,
    badge_url: null,
    target_url: payload.target_url,
    tag: "push-lab-test",
    custom_data: { kind: "test" },
    delivery_type: "immediate",
    scheduled_at: new Date().toISOString(),
    timezone: device.timezone
  });
  await supabase.from("device_events").insert({ device_id: device.id, event_type: "test_sent" });
  return insertNotification(req, ctx, supabase, device, notificationPayload);
}

async function handleRevokeDevice(req: Request, ctx: RequestContext, supabase: AdminClient, device: AuthenticatedDevice): Promise<Response> {
  const methodError = requireMethod(req, ctx, "POST");
  if (methodError) return methodError;
  const payload = revokeDeviceSchema.parse(await parseJson(req));
  if (payload.delete_remote_data) {
    const { error } = await supabase.from("devices").delete().eq("id", device.id);
    if (error) return fail(req, "DEVICE_DELETE_FAILED", "Nao foi possivel apagar dados remotos.", ctx, 500);
    return ok(req, { deleted: true }, ctx);
  }

  await supabase.from("push_subscriptions").update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("device_id", device.id);
  await supabase
    .from("notifications")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("device_id", device.id)
    .in("status", ["draft", "scheduled", "failed", "partially_failed"]);
  const { error } = await supabase
    .from("devices")
    .update({ status: "revoked", revoked_at: new Date().toISOString(), notifications_permission: "denied" })
    .eq("id", device.id);
  if (error) return fail(req, "DEVICE_REVOKE_FAILED", "Nao foi possivel revogar o dispositivo.", ctx, 500);
  await supabase.from("device_events").insert({ device_id: device.id, event_type: "device_revoked" });
  return ok(req, { revoked: true }, ctx);
}

async function handleProcessScheduled(req: Request, ctx: RequestContext, supabase: AdminClient): Promise<Response> {
  const methodError = requireMethod(req, ctx, "POST");
  if (methodError) return methodError;
  const expected = Deno.env.get("INTERNAL_CRON_SECRET");
  const received = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || received !== expected) return fail(req, "CRON_UNAUTHORIZED", "Chamada interna nao autorizada.", ctx, 401);

  const result = await processDueNotifications(supabase, { batchSize: 10 });
  logInfo("scheduled_processor_finished", { correlation_id: ctx.correlationId, ...result });
  return ok(req, result, ctx);
}

function handleHealth(req: Request, ctx: RequestContext): Response {
  if (req.method !== "GET" && req.method !== "POST") return fail(req, "METHOD_NOT_ALLOWED", "Metodo HTTP nao permitido.", ctx, 405);
  return ok(req, { status: "ok", app_version: Deno.env.get("APP_VERSION") || "0.1.0" }, ctx);
}

const publicHandlers: Record<string, Handler> = {
  "register-device": handleRegisterDevice,
  "process-scheduled-notifications": handleProcessScheduled,
  "retry-failed-notifications": handleProcessScheduled,
  "health-check": (req, ctx) => Promise.resolve(handleHealth(req, ctx))
};

const authenticatedHandlers: Record<string, AuthHandler> = {
  "update-device": handleUpdateDevice,
  "register-push-subscription": handleRegisterSubscription,
  "refresh-push-subscription": handleRegisterSubscription,
  "create-notification": handleCreateNotification,
  "update-notification": handleUpdateNotification,
  "cancel-notification": handleCancelNotification,
  "list-notifications": handleListNotifications,
  "get-notification": handleGetNotification,
  "send-test-notification": handleSendTest,
  "revoke-device": handleRevokeDevice
};

export function serveFunction(functionName: string): void {
  Deno.serve(async (req) => {
    const ctx = createRequestContext(req);
    if (req.method === "OPTIONS") return preflight(req);

    try {
      const supabase = adminClient();
      const publicHandler = publicHandlers[functionName];
      if (publicHandler) return await publicHandler(req, ctx, supabase);

      const authHandler = authenticatedHandlers[functionName];
      if (authHandler) return await withDevice(req, ctx, supabase, functionName, authHandler);

      return fail(req, "FUNCTION_NOT_FOUND", "Funcao nao encontrada.", ctx, 404);
    } catch (caught) {
      logWarn("function_error", {
        function_name: functionName,
        correlation_id: ctx.correlationId,
        error: sanitizeErrorMessage(caught)
      });
      return fail(req, "INTERNAL_ERROR", "Erro interno processado de forma segura.", ctx, 500);
    }
  });
}
