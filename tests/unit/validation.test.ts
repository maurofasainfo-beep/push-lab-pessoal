import { describe, expect, it } from "vitest";
import { isSafeHttpUrl, notificationFormSchema } from "../../apps/web/src/lib/validation";

describe("notification validation", () => {
  it("aceita formulario minimo de envio imediato", () => {
    const parsed = notificationFormSchema.parse({
      title: "",
      body: "Mensagem",
      targetUrl: "/",
      deliveryType: "immediate",
      timezone: "America/Sao_Paulo"
    });
    expect(parsed.title).toBe("");
  });

  it("rejeita javascript/data urls", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/plain,abc")).toBe(false);
  });

  it("exige HTTPS para imagem", () => {
    const result = notificationFormSchema.safeParse({
      title: "Titulo",
      body: "Mensagem",
      imageUrl: "http://example.com/a.png",
      targetUrl: "/",
      deliveryType: "immediate",
      timezone: "America/Sao_Paulo"
    });
    expect(result.success).toBe(false);
  });
});
