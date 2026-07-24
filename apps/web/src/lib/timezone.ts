import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

export function getDeviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function getDeviceLocale(): string {
  return navigator.language || "pt-BR";
}

export function localDateTimeToUtcIso(date: string, time: string, timezone: string): string {
  const localIsoLike = `${date}T${time.length === 5 ? `${time}:00` : time}`;
  const utcDate = fromZonedTime(localIsoLike, timezone);
  return utcDate.toISOString();
}

export function isFutureUtc(utcIso: string, minimumDelayMs = 30_000): boolean {
  return new Date(utcIso).getTime() > Date.now() + minimumDelayMs;
}

export function formatUtcForDevice(utcIso: string, timezone: string, locale = "pt-BR"): string {
  const pattern = locale.startsWith("pt") ? "dd/MM/yyyy HH:mm zzz" : "yyyy-MM-dd HH:mm zzz";
  return formatInTimeZone(utcIso, timezone, pattern);
}

export function splitUtcIntoLocalInputs(utcIso: string, timezone: string): { date: string; time: string } {
  const local = toZonedTime(utcIso, timezone);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  const hours = String(local.getHours()).padStart(2, "0");
  const minutes = String(local.getMinutes()).padStart(2, "0");
  return { date: `${year}-${month}-${day}`, time: `${hours}:${minutes}` };
}

