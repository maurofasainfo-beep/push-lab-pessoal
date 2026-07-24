import { describe, expect, it } from "vitest";
import { generateDeviceSecret, sha256Hex } from "../../apps/web/src/lib/device";

describe("device secret", () => {
  it("gera segredo opaco com entropia adequada para uso local", () => {
    const first = generateDeviceSecret();
    const second = generateDeviceSecret();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(43);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("gera hash SHA-256 sem armazenar segredo em claro", async () => {
    const hash = await sha256Hex("segredo-de-teste-comprido");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("segredo");
  });
});

