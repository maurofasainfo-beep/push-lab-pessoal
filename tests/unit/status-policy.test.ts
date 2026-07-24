import { describe, expect, it } from "vitest";
import { canEdit, canTransition } from "../../apps/web/src/lib/statusPolicy";

describe("notification status policy", () => {
  it("permite transicoes esperadas antes do envio", () => {
    expect(canTransition("scheduled", "processing")).toBe(true);
    expect(canTransition("failed", "scheduled")).toBe(true);
  });

  it("bloqueia edicao depois de sent ou cancelled", () => {
    expect(canEdit("sent")).toBe(false);
    expect(canEdit("cancelled")).toBe(false);
    expect(canEdit("scheduled")).toBe(true);
  });
});

