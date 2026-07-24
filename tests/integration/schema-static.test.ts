import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve("supabase_schema.sql"), "utf8");

describe("supabase schema static contract", () => {
  it("inclui entidades obrigatorias", () => {
    for (const table of ["devices", "push_subscriptions", "notifications", "notification_deliveries", "device_events"]) {
      expect(schema).toContain(`create table if not exists public.${table}`);
    }
  });

  it("usa claim concorrente com skip locked", () => {
    expect(schema.toLowerCase()).toContain("for update of n skip locked");
    expect(schema).toContain("push_lab_claim_due_notifications");
  });

  it("ativa RLS e evita politicas permissivas para anon/authenticated", () => {
    expect(schema).toContain("enable row level security");
    expect(schema).not.toMatch(/to anon using\s*\(true\)/i);
    expect(schema).not.toMatch(/to authenticated using\s*\(true\)/i);
  });

  it("nao contem chaves privadas reais", () => {
    expect(schema).not.toMatch(/VAPID_PRIVATE_KEY\s*=/);
    expect(schema).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY\s*=/);
  });
});

