import { describe, expect, it } from "vitest";
import { classifyWebPushResult, retryDelaySeconds } from "../../apps/web/src/lib/retryPolicy";

describe("web push retry policy", () => {
  it("expira inscricoes com 404/410", () => {
    expect(classifyWebPushResult(404)).toBe("expire_subscription");
    expect(classifyWebPushResult(410)).toBe("expire_subscription");
  });

  it("agenda retry para erros transitorios explicitos", () => {
    expect(classifyWebPushResult(429)).toBe("retry");
    expect(classifyWebPushResult(503)).toBe("retry");
    expect(retryDelaySeconds(1)).toBe(30);
    expect(retryDelaySeconds(3)).toBe(120);
  });

  it("nao faz retry automatico quando o estado e desconhecido", () => {
    expect(classifyWebPushResult(undefined, "TimeoutError")).toBe("unknown_no_auto_retry");
  });
});

