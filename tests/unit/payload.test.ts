import { describe, expect, it, vi } from "vitest";
import { prepareNotificationInput } from "../../apps/web/src/lib/notificationPayload";

describe("notification payload preparation", () => {
  it("monta payload agendado em UTC", () => {
    vi.setSystemTime(new Date("2026-07-24T10:00:00.000Z"));
    const payload = prepareNotificationInput({
      title: "Alerta",
      body: "Mensagem",
      targetUrl: "/detalhes",
      imageUrl: "",
      iconUrl: "",
      badgeUrl: "",
      tag: "teste",
      customData: "{\"origem\":\"unit\"}",
      deliveryType: "scheduled",
      date: "2026-07-24",
      time: "09:00",
      timezone: "America/Sao_Paulo"
    });
    expect(payload.scheduled_at).toBe("2026-07-24T12:00:00.000Z");
    expect(payload.custom_data).toEqual({ origem: "unit" });
    vi.useRealTimers();
  });
});

