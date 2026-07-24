import type { NotificationStatus } from "../types/domain";

const transitions: Record<NotificationStatus, NotificationStatus[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["processing", "cancelled", "draft"],
  processing: ["sent", "failed", "partially_failed", "scheduled"],
  sent: [],
  partially_failed: ["scheduled", "failed", "cancelled"],
  failed: ["scheduled", "cancelled"],
  cancelled: []
};

export function canTransition(from: NotificationStatus, to: NotificationStatus): boolean {
  return transitions[from].includes(to);
}

export function canEdit(status: NotificationStatus): boolean {
  return ["draft", "scheduled", "failed", "partially_failed"].includes(status);
}

