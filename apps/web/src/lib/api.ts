import type { ApiEnvelope, NotificationItem, StoredDevice } from "../types/domain";

export interface ApiConfig {
  apiBaseUrl: string;
  appVersion: string;
}

export function getApiConfig(): ApiConfig {
  return {
    apiBaseUrl: import.meta.env.VITE_API_BASE_URL || "/api",
    appVersion: import.meta.env.VITE_APP_VERSION || "0.1.0"
  };
}

export function hasApiConfig(): boolean {
  return true;
}

export async function callFunction<T>(
  functionName: string,
  body: unknown = {},
  options: { method?: "GET" | "POST"; device?: StoredDevice | null } = {}
): Promise<T> {
  const config = getApiConfig();

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-app-version": config.appVersion
  };

  if (options.device) {
    headers["x-device-public-id"] = options.device.publicId;
    headers["x-device-secret"] = options.device.secret;
  }

  const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, "")}/${functionName}`, {
    method: options.method || "POST",
    headers,
    body: (options.method || "POST") === "GET" ? undefined : JSON.stringify(body)
  });

  const envelope = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !envelope?.success) {
    const code = envelope?.error?.code || `HTTP_${response.status}`;
    const message = envelope?.error?.message || "Falha ao chamar backend.";
    throw new Error(`${code}: ${message}`);
  }

  return envelope.data as T;
}

export async function listNotifications(device: StoredDevice, status?: string): Promise<NotificationItem[]> {
  const data = await callFunction<{ notifications: NotificationItem[] }>("list-notifications", { status }, { device });
  return data.notifications;
}
