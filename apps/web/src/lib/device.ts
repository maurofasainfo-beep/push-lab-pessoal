import { getDeviceLocale, getDeviceTimezone } from "./timezone";
import type { StoredDevice } from "../types/domain";

const STORAGE_KEY = "push_lab_device_v1";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function generateDeviceSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function loadDevice(): StoredDevice | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDevice;
    if (!parsed.publicId || !parsed.secret) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDevice(device: StoredDevice): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(device));
}

export function clearDevice(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function createPendingDevice(name?: string): Omit<StoredDevice, "publicId"> {
  return {
    secret: generateDeviceSecret(),
    name: name?.trim() || defaultDeviceName(),
    timezone: getDeviceTimezone(),
    locale: getDeviceLocale(),
    appVersion: import.meta.env.VITE_APP_VERSION || "0.1.0"
  };
}

export function defaultDeviceName(): string {
  const platform = navigator.platform || "Dispositivo";
  return `Meu ${platform}`.replace(/\s+/g, " ").trim();
}

