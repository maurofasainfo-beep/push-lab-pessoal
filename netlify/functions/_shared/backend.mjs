import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { z } from "zod";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
};

function correlationId(req) {
  return req.headers.get("x-correlation-id") || `corr_${randomUUID()}`;
}

function allowedOrigins() {
  return String(process.env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function corsHeaders(req) {
  const origin = req.headers.get("origin");
  const allowed = allowedOrigins();
  const allowOrigin = origin && (allowed.length === 0 || allowed.includes(origin)) ? origin : allowed[0] || "*";
  return {
    ...jsonHeaders,
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-headers": "authorization, content-type, x-app-version, x-device-public-id, x-device-secret, x-correlation-id",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    vary: "Origin"
  };
}

function isAllowedOrigin(req) {
  const origin = req.headers.get("origin");
  const allowed = allowedOrigins();
  return !origin || allowed.length === 0 || allowed.includes(origin);
}

export function preflight(req) {
  return new Response(null, { status: isAllowedOrigin(req) ? 204 : 403, headers: corsHeaders(req) });
}

function ok(req, data, ctx, status = 200) {
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

function fail(req, code, message, ctx, status = 400) {
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

function sanitizeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]").slice(0, 500);
}

async function parseJson(req, maxBytes = 16_384) {
  const raw = await req.text();
  if (raw.length > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  if (!raw) return {};
  return JSON.parse(raw);
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function adminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole || url.includes("COLE_AQUI") || serviceRole.includes("COLE_AQUI")) {
    throw new Error("SUPABASE_BACKEND_ENV_MISSING");
  }
  return createClient(url, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

async function checkRateLimit(supabase, key, action, maxRequests, windowSeconds) {
  const { data, error } = await supabase.rpc("push_lab_check_rate_limit", {
    p_key_hash: sha256Hex(`${key}:${action}`),
    p_action: action,
    p_max_requests: maxRequests,
    p_window_seconds: windowSeconds
  });
  if (error) return false;
  return Boolean(data);
}

function clientAddress(req) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function authenticateDevice(req, ctx, supabase) {
  const publicId = req.headers.get("x-device-public-id")?.trim() || "";
  const secret = req.headers.get("x-device-secret") || "";
  if (!publicId || !secret) return fail(req, "DEVICE_AUTH_REQUIRED", "Dispositivo nao autenticado.", ctx, 401);

  const secretHash = sha256Hex(secret);
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

const httpUrl = z
  .string()
  .trim()
  .max(1000)
  .nullable()
  .optional()
  .refine((value) => {
    if (!value) return true;
    if (value.startsWith("/") && !value.startsWith("//")) return true;
    try {
      const url = new URL(value);
      return !url.username && !url.password && (url.protocol === "https:" || url.protocol === "http:");
    } catch {
      return false;
    }
  }, "URL invalida.");

const httpsUrl = z
  .string()
  .trim()
  .max(1000)
  .nullable()
  .optional()
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return !url.username && !url.password && url.protocol === "https:";
    } catch {
      return false;
    }
  }, "URL HTTPS invalida.");

const registerDeviceSchema = z.object({
  device_secret: z.string().min(32).max(256),
  name: z.string().trim().min(1).max(80),
  timezone: z.string().trim().min(1).max(80),
  locale: z.string().trim().min(2).max(35),
  app_version: z.string().trim().min(1).max(40),
  notifications_permission: z.enum(["default", "denied", "granted"]).optional().default("default"),
  user_agent: z.string().max(500).optional()
});

const updateDeviceSchema = z.object({
  name: z.string().trim().min(1).max(80)
});

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(20).max(500),
    auth: z.string().min(10).max(200)
  })
});

const registerSubscriptionSchema = z.object({
  subscription: pushSubscriptionSchema,
  notifications_permission: z.enum(["default", "denied", "granted"]).optional().default("granted")
});

const notificationInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(600),
  image_url: httpsUrl,
  icon_url: httpsUrl,
  badge_url: httpsUrl,
  target_url: httpUrl,
  tag: z.string().trim().max(80).nullable().optional(),
  custom_data: z.record(z.string(), z.unknown()).optional().default({}),
  delivery_type: z.enum(["immediate", "scheduled"]),
  scheduled_at: z.string().datetime(),
  timezone: z.string().trim().min(1).max(80)
});

const updateNotificationSchema = notificationInputSchema.extend({
  id: z.string().uuid()
});

const idSchema = z.object({ id: z.string().uuid() });
const listNotificationsSchema = z.object({
  status: z.string().max(40).optional().nullable(),
  limit: z.number().int().min(1).max(100).optional().default(50)
});
const sendTestSchema = z.object({
  title: z.string().trim().min(1).max(120).optional().default("Teste do Push Lab Pessoal"),
  body: z.string().trim().min(1).max(600).optional().default("Se voce recebeu esta mensagem, o Web Push esta funcionando."),
  target_url: httpUrl.default("/")
});
const revokeDeviceSchema = z.object({ delete_remote_data: z.boolean().optional().default(false) });

function vapidDetails() {
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) throw new Error("VAPID_CONFIG_MISSING");
  return { subject, publicKey, privateKey };
}

function buildPayload(notification) {
  return JSON.stringify({
    notification_id: notification.id,
    title: notification.title,
    body: notification.body,
    image_url: notification.image_url,
    icon_url: notification.icon_url || "/icons/icon-192.png",
    badge_url: notification.badge_url || "/icons/icon-192.png",
    target_url: notification.target_url || "/",
    tag: notification.tag,
    data: notification.custom_data || {}
  });
}

function classifyFailure(statusCode, errorName) {
  if (statusCode === 404 || statusCode === 410) return "permanent";
  if (statusCode === 408 || statusCode === 429 || (statusCode && statusCode >= 500)) return "transient";
  if (!statusCode && (errorName === "AbortError" || errorName === "TimeoutError")) return "unknown";
  if (!statusCode) return "unknown";
  return "permanent";
}

function nextRetryIso(attempt) {
  const delaySeconds = Math.min(900, 30 * 2 ** Math.max(0, attempt - 1));
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

export async function processDueNotifications(supabase, options = {}) {
  const { data: claimed, error: claimError } = await supabase.rpc("push_lab_claim_due_notifications", {
    p_now: new Date().toISOString(),
    p_limit: options.batchSize || 10,
    p_notification_id: options.notificationId || null
  });

  if (claimError) throw new Error(`CLAIM_FAILED:${claimError.message}`);

  const notifications = claimed || [];
  let sent = 0;
  let failed = 0;
  let invalidSubscriptions = 0;
  let unknown = 0;

  for (const notification of notifications) {
    const { data: subscriptions, error: subError } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("device_id", notification.device_id)
      .eq("status", "active")
      .is("revoked_at", null);

    if (subError) throw new Error(`SUBSCRIPTION_LOOKUP_FAILED:${subError.message}`);

    const activeSubscriptions = subscriptions || [];
    if (activeSubscriptions.length === 0) {
      await supabase
        .from("notifications")
        .update({
          status: "failed",
          last_error_code: "NO_ACTIVE_SUBSCRIPTION",
          processing_started_at: null,
          next_retry_at: null
        })
        .eq("id", notification.id);
      failed += 1;
      continue;
    }

    let successCount = 0;
    let transientFailureCount = 0;
    let permanentFailureCount = 0;
    let unknownCount = 0;
    let lastErrorCode = null;
    const attemptNumber = notification.attempt_count;

    for (const subscription of activeSubscriptions) {
      const { data: delivery, error: deliveryError } = await supabase
        .from("notification_deliveries")
        .insert({
          notification_id: notification.id,
          push_subscription_id: subscription.id,
          attempt_number: attemptNumber,
          status: "processing",
          attempted_at: new Date().toISOString()
        })
        .select("id")
        .single();

      if (deliveryError) {
        lastErrorCode = "DELIVERY_RECORD_FAILED";
        transientFailureCount += 1;
        continue;
      }

      try {
        const response = await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth
            }
          },
          buildPayload(notification),
          {
            TTL: 86_400,
            timeout: 12_000,
            contentEncoding: "aes128gcm",
            vapidDetails: vapidDetails()
          }
        );

        await supabase
          .from("notification_deliveries")
          .update({
            status: "sent",
            provider_status_code: response.statusCode || 201,
            error_code: null,
            error_message: null,
            delivered_at: null,
            next_retry_at: null
          })
          .eq("id", delivery.id);
        successCount += 1;
      } catch (caught) {
        const statusCode = caught?.statusCode;
        const kind = classifyFailure(statusCode, caught?.name);
        const retryAt = kind === "transient" && attemptNumber < notification.max_attempts ? nextRetryIso(attemptNumber) : null;
        const deliveryStatus = kind === "unknown" ? "unknown" : kind === "transient" ? "retry_scheduled" : "permanent_failed";
        lastErrorCode = caught?.code || (statusCode ? `WEB_PUSH_${statusCode}` : "WEB_PUSH_UNKNOWN");

        await supabase
          .from("notification_deliveries")
          .update({
            status: deliveryStatus,
            provider_status_code: statusCode || null,
            error_code: lastErrorCode,
            error_message: sanitizeErrorMessage(caught),
            next_retry_at: retryAt
          })
          .eq("id", delivery.id);

        if (kind === "permanent") {
          permanentFailureCount += 1;
          if (statusCode === 404 || statusCode === 410) {
            invalidSubscriptions += 1;
            await supabase
              .from("push_subscriptions")
              .update({
                status: "expired",
                last_failure_at: new Date().toISOString(),
                failure_count: 999,
                revoked_at: new Date().toISOString()
              })
              .eq("id", subscription.id);
          }
        } else if (kind === "transient") {
          transientFailureCount += 1;
        } else {
          unknownCount += 1;
        }
      }
    }

    const hasSuccess = successCount > 0;
    const hasRetry = transientFailureCount > 0 && attemptNumber < notification.max_attempts;
    const notificationStatus =
      hasSuccess && transientFailureCount + permanentFailureCount + unknownCount === 0
        ? "sent"
        : hasSuccess
          ? "partially_failed"
          : "failed";

    await supabase
      .from("notifications")
      .update({
        status: notificationStatus,
        sent_at: hasSuccess ? new Date().toISOString() : null,
        processing_started_at: null,
        next_retry_at: hasRetry ? nextRetryIso(attemptNumber) : null,
        last_error_code: lastErrorCode
      })
      .eq("id", notification.id);

    sent += successCount;
    failed += transientFailureCount + permanentFailureCount;
    unknown += unknownCount;
  }

  return { claimed: notifications.length, sent, failed, invalidSubscriptions, unknown };
}

async function insertNotification(req, ctx, supabase, device, payload) {
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

async function handleRegisterDevice(req, ctx, supabase) {
  const payload = registerDeviceSchema.parse(await parseJson(req));
  const withinLimit = await checkRateLimit(supabase, clientAddress(req), "register-device", 12, 60);
  if (!withinLimit) return fail(req, "RATE_LIMITED", "Muitas tentativas de registro.", ctx, 429);

  const publicId = `dev_${randomUUID().replaceAll("-", "")}`;
  const { data, error } = await supabase
    .from("devices")
    .insert({
      public_id: publicId,
      secret_hash: sha256Hex(payload.device_secret),
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

async function handleUpdateDevice(req, ctx, supabase, device) {
  const payload = updateDeviceSchema.parse(await parseJson(req));
  const { data, error } = await supabase.from("devices").update({ name: payload.name }).eq("id", device.id).select("name").single();
  if (error) return fail(req, "DEVICE_UPDATE_FAILED", "Nao foi possivel atualizar o dispositivo.", ctx, 500);
  return ok(req, data, ctx);
}

async function handleRegisterSubscription(req, ctx, supabase, device) {
  const payload = registerSubscriptionSchema.parse(await parseJson(req));
  const endpointHash = sha256Hex(payload.subscription.endpoint);
  const { data: existing, error: existingError } = await supabase
    .from("push_subscriptions")
    .select("id, device_id")
    .eq("endpoint_hash", endpointHash)
    .maybeSingle();

  if (existingError) return fail(req, "SUBSCRIPTION_LOOKUP_FAILED", "Falha ao verificar inscricao.", ctx, 500);
  if (existing && existing.device_id !== device.id) return fail(req, "SUBSCRIPTION_CONFLICT", "Esta inscricao ja pertence a outro dispositivo.", ctx, 409);

  const record = {
    device_id: device.id,
    endpoint: payload.subscription.endpoint,
    endpoint_hash: endpointHash,
    p256dh: payload.subscription.keys.p256dh,
    auth: payload.subscription.keys.auth,
    status: "active",
    expires_at: payload.subscription.expirationTime ? new Date(payload.subscription.expirationTime).toISOString() : null,
    revoked_at: null
  };

  const query = existing ? supabase.from("push_subscriptions").update(record).eq("id", existing.id) : supabase.from("push_subscriptions").insert(record);
  const { error } = await query;
  if (error) return fail(req, "SUBSCRIPTION_REGISTER_FAILED", "Nao foi possivel salvar a inscricao Web Push.", ctx, 500);
  await supabase.from("devices").update({ notifications_permission: payload.notifications_permission }).eq("id", device.id);
  return ok(req, { status: "active" }, ctx, existing ? 200 : 201);
}

async function handleCreateNotification(req, ctx, supabase, device) {
  return insertNotification(req, ctx, supabase, device, notificationInputSchema.parse(await parseJson(req)));
}

async function handleUpdateNotification(req, ctx, supabase, device) {
  const payload = updateNotificationSchema.parse(await parseJson(req));
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

async function handleCancelNotification(req, ctx, supabase, device) {
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

async function handleListNotifications(req, ctx, supabase, device) {
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

async function handleGetNotification(req, ctx, supabase, device) {
  const payload = idSchema.parse(await parseJson(req));
  const { data: notification, error } = await supabase.from("notifications").select("*").eq("id", payload.id).eq("device_id", device.id).maybeSingle();
  if (error) return fail(req, "NOTIFICATION_LOOKUP_FAILED", "Falha ao consultar notificacao.", ctx, 500);
  if (!notification) return fail(req, "NOTIFICATION_NOT_FOUND", "Notificacao nao encontrada.", ctx, 404);
  const { data: deliveries } = await supabase.from("notification_deliveries").select("*").eq("notification_id", payload.id).order("attempted_at", { ascending: false });
  return ok(req, { notification, deliveries: deliveries || [] }, ctx);
}

async function handleSendTest(req, ctx, supabase, device) {
  const payload = sendTestSchema.parse(await parseJson(req));
  return insertNotification(
    req,
    ctx,
    supabase,
    device,
    notificationInputSchema.parse({
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
    })
  );
}

async function handleRevokeDevice(req, ctx, supabase, device) {
  const payload = revokeDeviceSchema.parse(await parseJson(req));
  if (payload.delete_remote_data) {
    const { error } = await supabase.from("devices").delete().eq("id", device.id);
    if (error) return fail(req, "DEVICE_DELETE_FAILED", "Nao foi possivel apagar dados remotos.", ctx, 500);
    return ok(req, { deleted: true }, ctx);
  }
  await supabase.from("push_subscriptions").update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("device_id", device.id);
  await supabase.from("notifications").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("device_id", device.id).in("status", ["draft", "scheduled", "failed", "partially_failed"]);
  const { error } = await supabase.from("devices").update({ status: "revoked", revoked_at: new Date().toISOString(), notifications_permission: "denied" }).eq("id", device.id);
  if (error) return fail(req, "DEVICE_REVOKE_FAILED", "Nao foi possivel revogar o dispositivo.", ctx, 500);
  return ok(req, { revoked: true }, ctx);
}

async function handleProcessScheduled(req, ctx, supabase) {
  const expected = process.env.INTERNAL_CRON_SECRET;
  const received = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || received !== expected) return fail(req, "CRON_UNAUTHORIZED", "Chamada interna nao autorizada.", ctx, 401);
  return ok(req, await processDueNotifications(supabase, { batchSize: 10 }), ctx);
}

const publicHandlers = {
  "register-device": handleRegisterDevice,
  "health-check": async (req, ctx) => ok(req, { status: "ok", runtime: "netlify", app_version: process.env.APP_VERSION || "0.1.0" }, ctx),
  "process-scheduled-notifications": handleProcessScheduled,
  "retry-failed-notifications": handleProcessScheduled
};

const authenticatedHandlers = {
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

export async function handleApi(req, routeName) {
  const ctx = { correlationId: correlationId(req), startedAt: Date.now() };
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST" && routeName !== "health-check") return fail(req, "METHOD_NOT_ALLOWED", "Metodo HTTP nao permitido.", ctx, 405);
  if (!isAllowedOrigin(req)) return fail(req, "ORIGIN_NOT_ALLOWED", "Origem nao autorizada.", ctx, 403);

  try {
    const supabase = adminClient();
    const publicHandler = publicHandlers[routeName];
    if (publicHandler) return await publicHandler(req, ctx, supabase);

    const authHandler = authenticatedHandlers[routeName];
    if (!authHandler) return fail(req, "FUNCTION_NOT_FOUND", "Endpoint nao encontrado.", ctx, 404);

    const device = await authenticateDevice(req, ctx, supabase);
    if (device instanceof Response) return device;
    const withinLimit = await checkRateLimit(supabase, device.public_id, routeName, routeName === "create-notification" ? 30 : 60, 60);
    if (!withinLimit) return fail(req, "RATE_LIMITED", "Limite temporario atingido.", ctx, 429);
    return await authHandler(req, ctx, supabase, device);
  } catch (caught) {
    console.warn(JSON.stringify({ level: "warn", event: "api_error", route: routeName, correlation_id: ctx.correlationId, error: sanitizeErrorMessage(caught) }));
    return fail(req, "INTERNAL_ERROR", sanitizeErrorMessage(caught), ctx, 500);
  }
}

export function getAdminClient() {
  return adminClient();
}

