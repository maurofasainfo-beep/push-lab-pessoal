import { z } from "zod";

export const TITLE_MAX_LENGTH = 120;
export const BODY_MAX_LENGTH = 600;
export const URL_MAX_LENGTH = 1000;
export const TAG_MAX_LENGTH = 80;
export const CUSTOM_DATA_MAX_CHARS = 4096;

export function isSafeHttpUrl(value: string, options: { requireHttps?: boolean; allowRelative?: boolean } = {}): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (options.allowRelative && trimmed.startsWith("/")) return !trimmed.startsWith("//");

  try {
    const url = new URL(trimmed);
    if (url.username || url.password) return false;
    if (options.requireHttps) return url.protocol === "https:";
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const optionalSafeUrl = (label: string, requireHttps = false) =>
  z
    .string()
    .trim()
    .max(URL_MAX_LENGTH, `${label} deve ter no maximo ${URL_MAX_LENGTH} caracteres.`)
    .optional()
    .or(z.literal(""))
    .refine((value) => !value || isSafeHttpUrl(value, { requireHttps, allowRelative: label === "URL de destino" }), {
      message: `${label} deve ser uma URL ${requireHttps ? "HTTPS " : "HTTP/HTTPS "}valida e segura.`
    });

export const customDataSchema = z
  .string()
  .trim()
  .max(CUSTOM_DATA_MAX_CHARS, `Dados adicionais devem ter no maximo ${CUSTOM_DATA_MAX_CHARS} caracteres.`)
  .optional()
  .or(z.literal(""))
  .refine((value) => {
    if (!value) return true;
    try {
      const parsed = JSON.parse(value);
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
    } catch {
      return false;
    }
  }, "Dados adicionais devem ser um objeto JSON valido.");

export const notificationFormSchema = z
  .object({
    title: z.string().trim().min(1, "Titulo obrigatorio.").max(TITLE_MAX_LENGTH, `Titulo deve ter no maximo ${TITLE_MAX_LENGTH} caracteres.`),
    body: z.string().trim().min(1, "Mensagem obrigatoria.").max(BODY_MAX_LENGTH, `Mensagem deve ter no maximo ${BODY_MAX_LENGTH} caracteres.`),
    imageUrl: optionalSafeUrl("Imagem", true),
    iconUrl: optionalSafeUrl("Icone", true),
    badgeUrl: optionalSafeUrl("Badge", true),
    targetUrl: optionalSafeUrl("URL de destino"),
    tag: z.string().trim().max(TAG_MAX_LENGTH, `Etiqueta deve ter no maximo ${TAG_MAX_LENGTH} caracteres.`).optional().or(z.literal("")),
    customData: customDataSchema,
    deliveryType: z.enum(["immediate", "scheduled"]),
    date: z.string().optional().or(z.literal("")),
    time: z.string().optional().or(z.literal("")),
    timezone: z.string().min(1, "Timezone obrigatorio.")
  })
  .superRefine((value, ctx) => {
    if (value.deliveryType === "scheduled") {
      if (!value.date) {
        ctx.addIssue({ code: "custom", path: ["date"], message: "Data obrigatoria para agendamento." });
      }
      if (!value.time) {
        ctx.addIssue({ code: "custom", path: ["time"], message: "Horario obrigatorio para agendamento." });
      }
    }
  });

export type NotificationFormValues = z.infer<typeof notificationFormSchema>;

export const deviceNameSchema = z.string().trim().min(1, "Nome obrigatorio.").max(80, "Nome deve ter no maximo 80 caracteres.");

export function parseCustomData(value?: string): Record<string, unknown> {
  if (!value?.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  return {};
}

