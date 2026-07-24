import { z } from "zod";

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

export const registerDeviceSchema = z.object({
  device_secret: z.string().min(32).max(256),
  name: z.string().trim().min(1).max(80),
  timezone: z.string().trim().min(1).max(80),
  locale: z.string().trim().min(2).max(35),
  app_version: z.string().trim().min(1).max(40),
  notifications_permission: z.enum(["default", "denied", "granted"]).optional().default("default"),
  user_agent: z.string().max(500).optional()
});

export const updateDeviceSchema = z.object({
  name: z.string().trim().min(1).max(80)
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(20).max(500),
    auth: z.string().min(10).max(200)
  })
});

export const registerSubscriptionSchema = z.object({
  subscription: pushSubscriptionSchema,
  notifications_permission: z.enum(["default", "denied", "granted"]).optional().default("granted")
});

export const notificationInputSchema = z.object({
  title: z.string().trim().max(120).optional().default(""),
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

export const updateNotificationSchema = notificationInputSchema.extend({
  id: z.string().uuid()
});

export const idSchema = z.object({
  id: z.string().uuid()
});

export const listNotificationsSchema = z.object({
  status: z.string().max(40).optional().nullable(),
  limit: z.number().int().min(1).max(100).optional().default(50)
});

export const sendTestSchema = z.object({
  title: z.string().trim().max(120).optional().default(""),
  body: z.string().trim().min(1).max(600).optional().default("Se voce recebeu esta mensagem, o Web Push esta funcionando."),
  target_url: httpUrl.default("/")
});

export const revokeDeviceSchema = z.object({
  delete_remote_data: z.boolean().optional().default(false)
});
