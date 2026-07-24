export type DeliveryType = "immediate" | "scheduled";
export type NotificationStatus =
  | "draft"
  | "scheduled"
  | "processing"
  | "sent"
  | "partially_failed"
  | "failed"
  | "cancelled";

export type SubscriptionStatus = "active" | "expired" | "revoked" | "failed";
export type DeviceStatus = "active" | "revoked";

export interface StoredDevice {
  publicId: string;
  secret: string;
  name: string;
  timezone: string;
  locale: string;
  appVersion: string;
}

export interface PushSubscriptionDto {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  icon_url: string | null;
  badge_url: string | null;
  target_url: string | null;
  tag: string | null;
  custom_data: Record<string, unknown>;
  delivery_type: DeliveryType;
  scheduled_at: string;
  status: NotificationStatus;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  sent_at: string | null;
  attempt_count: number;
  max_attempts: number;
  last_error_code: string | null;
}

export interface DeliveryItem {
  id: string;
  notification_id: string;
  attempt_number: number;
  status: string;
  provider_status_code: number | null;
  error_code: string | null;
  error_message: string | null;
  attempted_at: string;
  delivered_at: string | null;
  next_retry_at: string | null;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: null | {
    code: string;
    message: string;
    correlation_id?: string;
  };
}

