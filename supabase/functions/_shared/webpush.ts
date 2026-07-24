// @deno-types="npm:@types/web-push@3.6.4"
import webpush from "web-push";
import type { AdminClient } from "./db.ts";
import { sanitizeErrorMessage } from "./response.ts";

interface NotificationRow {
  id: string;
  device_id: string;
  title: string;
  body: string;
  image_url: string | null;
  icon_url: string | null;
  badge_url: string | null;
  target_url: string | null;
  tag: string | null;
  custom_data: Record<string, unknown> | null;
  attempt_count: number;
  max_attempts: number;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

type FailureKind = "permanent" | "transient" | "unknown";

function vapidDetails() {
  const subject = Deno.env.get("VAPID_SUBJECT");
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!subject || !publicKey || !privateKey) throw new Error("VAPID_CONFIG_MISSING");
  return { subject, publicKey, privateKey };
}

function buildPayload(notification: NotificationRow): string {
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

function classifyFailure(statusCode?: number, errorName?: string): FailureKind {
  if (statusCode === 404 || statusCode === 410) return "permanent";
  if (statusCode === 408 || statusCode === 429 || (statusCode && statusCode >= 500)) return "transient";
  if (!statusCode && (errorName === "AbortError" || errorName === "TimeoutError")) return "unknown";
  if (!statusCode) return "unknown";
  return "permanent";
}

function nextRetryIso(attempt: number): string {
  const delaySeconds = Math.min(900, 30 * 2 ** Math.max(0, attempt - 1));
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

export async function processDueNotifications(
  supabase: AdminClient,
  options: { batchSize?: number; notificationId?: string | null } = {}
): Promise<{ claimed: number; sent: number; failed: number; invalidSubscriptions: number; unknown: number }> {
  const { data: claimed, error: claimError } = await supabase.rpc("push_lab_claim_due_notifications", {
    p_now: new Date().toISOString(),
    p_limit: options.batchSize || 10,
    p_notification_id: options.notificationId || null
  });

  if (claimError) throw new Error(`CLAIM_FAILED:${claimError.message}`);

  const notifications = (claimed || []) as NotificationRow[];
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

    const activeSubscriptions = (subscriptions || []) as SubscriptionRow[];
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
    let lastErrorCode: string | null = null;
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
        const errorLike = caught as { statusCode?: number; code?: string; name?: string; message?: string };
        const kind = classifyFailure(errorLike.statusCode, errorLike.name);
        const sanitized = sanitizeErrorMessage(caught);
        const retryAt = kind === "transient" && attemptNumber < notification.max_attempts ? nextRetryIso(attemptNumber) : null;
        const deliveryStatus = kind === "unknown" ? "unknown" : kind === "transient" ? "retry_scheduled" : "permanent_failed";
        lastErrorCode = errorLike.code || (errorLike.statusCode ? `WEB_PUSH_${errorLike.statusCode}` : "WEB_PUSH_UNKNOWN");

        await supabase
          .from("notification_deliveries")
          .update({
            status: deliveryStatus,
            provider_status_code: errorLike.statusCode || null,
            error_code: lastErrorCode,
            error_message: sanitized,
            next_retry_at: retryAt
          })
          .eq("id", delivery.id);

        if (kind === "permanent") {
          permanentFailureCount += 1;
          if (errorLike.statusCode === 404 || errorLike.statusCode === 410) {
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
    const notificationStatus = hasSuccess && transientFailureCount + permanentFailureCount + unknownCount === 0
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
