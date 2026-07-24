import type { NotificationFormValues } from "./validation";
import { parseCustomData } from "./validation";
import { isFutureUtc, localDateTimeToUtcIso } from "./timezone";

export interface PreparedNotificationInput {
  title: string;
  body: string;
  image_url: string | null;
  icon_url: string | null;
  badge_url: string | null;
  target_url: string | null;
  tag: string | null;
  custom_data: Record<string, unknown>;
  delivery_type: "immediate" | "scheduled";
  scheduled_at: string;
  timezone: string;
}

function nullable(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function prepareNotificationInput(values: NotificationFormValues): PreparedNotificationInput {
  const scheduledAt =
    values.deliveryType === "scheduled" && values.date && values.time
      ? localDateTimeToUtcIso(values.date, values.time, values.timezone)
      : new Date().toISOString();

  if (values.deliveryType === "scheduled" && !isFutureUtc(scheduledAt)) {
    throw new Error("INVALID_SCHEDULE_DATE: A data deve estar no futuro.");
  }

  return {
    title: values.title?.trim() || "",
    body: values.body.trim(),
    image_url: nullable(values.imageUrl),
    icon_url: nullable(values.iconUrl),
    badge_url: nullable(values.badgeUrl),
    target_url: nullable(values.targetUrl),
    tag: nullable(values.tag),
    custom_data: parseCustomData(values.customData),
    delivery_type: values.deliveryType,
    scheduled_at: scheduledAt,
    timezone: values.timezone
  };
}

export function summarizeStatus(status: string): string {
  const labels: Record<string, string> = {
    draft: "Rascunho",
    scheduled: "Agendada",
    processing: "Processando",
    sent: "Enviada",
    partially_failed: "Parcialmente falha",
    failed: "Falha",
    cancelled: "Cancelada"
  };
  return labels[status] || status;
}
