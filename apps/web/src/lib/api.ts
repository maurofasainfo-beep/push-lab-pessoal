import type { ApiEnvelope, NotificationItem, StoredDevice } from "../types/domain";

export interface ApiConfig {
  supabaseUrl: string;
  anonKey: string;
  appVersion: string;
}

export function getApiConfig(): ApiConfig {
  return {
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL || "",
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || "",
    appVersion: import.meta.env.VITE_APP_VERSION || "0.1.0"
  };
}

export function hasApiConfig(): boolean {
  const config = getApiConfig();
  return Boolean(config.supabaseUrl && config.anonKey);
}

export async function callFunction<T>(
  functionName: string,
  body: unknown = {},
  options: { method?: "GET" | "POST"; device?: StoredDevice | null } = {}
): Promise<T> {
  const config = getApiConfig();
  if (!config.supabaseUrl || !config.anonKey) {
    throw new Error("CONFIG_MISSING: Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.");
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    apikey: config.anonKey,
    "x-app-version": config.appVersion
  };

  if (options.device) {
    headers["x-device-public-id"] = options.device.publicId;
    headers["x-device-secret"] = options.device.secret;
  }

  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, "")}/functions/v1/${functionName}`, {
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
