export interface AgentAnnouncement {
  requestId: string;
  answer: string;
}

export type AgentAnnouncementEvent =
  | { type: "request_started" }
  | { type: "request_failed" }
  | { type: "answer_settled"; requestId: string; answer: string }
  | { type: "conversation_cleared" };

/** Keep a settled answer stable while a follow-up is pending or fails. */
export function reduceAgentAnnouncement(
  current: AgentAnnouncement | null,
  event: AgentAnnouncementEvent,
): AgentAnnouncement | null {
  if (event.type === "answer_settled") {
    return { requestId: event.requestId, answer: event.answer };
  }
  if (event.type === "conversation_cleared") return null;
  return current;
}
