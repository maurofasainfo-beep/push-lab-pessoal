import { describe, expect, it } from "vitest";
import { formatUtcForDevice, isFutureUtc, localDateTimeToUtcIso, splitUtcIntoLocalInputs } from "../../apps/web/src/lib/timezone";

describe("timezone conversion", () => {
  it("converte horario local para UTC sem dupla conversao", () => {
    const utc = localDateTimeToUtcIso("2026-07-24", "09:30", "America/Sao_Paulo");
    expect(utc).toBe("2026-07-24T12:30:00.000Z");
    expect(splitUtcIntoLocalInputs(utc, "America/Sao_Paulo")).toEqual({ date: "2026-07-24", time: "09:30" });
  });

  it("mantem roundtrip em timezone com horario de verao", () => {
    const utc = localDateTimeToUtcIso("2026-11-01", "01:30", "America/New_York");
    const formatted = formatUtcForDevice(utc, "America/New_York", "en-US");
    expect(formatted).toContain("01:30");
  });

  it("detecta agendamento no passado", () => {
    expect(isFutureUtc("2020-01-01T00:00:00.000Z")).toBe(false);
  });
});

