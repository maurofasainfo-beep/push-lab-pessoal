export type RetryDecision = "retry" | "expire_subscription" | "do_not_retry" | "unknown_no_auto_retry";

export function classifyWebPushResult(statusCode?: number, errorName?: string): RetryDecision {
  if (statusCode === 404 || statusCode === 410) return "expire_subscription";
  if (statusCode === 408 || statusCode === 429 || (statusCode !== undefined && statusCode >= 500)) return "retry";
  if (!statusCode && (errorName === "AbortError" || errorName === "TimeoutError")) return "unknown_no_auto_retry";
  if (!statusCode) return "unknown_no_auto_retry";
  return "do_not_retry";
}

export function retryDelaySeconds(attempt: number): number {
  return Math.min(900, 30 * 2 ** Math.max(0, attempt - 1));
}

