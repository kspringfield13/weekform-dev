export type Screen = "setup" | "ledger" | "daily" | "weekly" | "forecast" | "weekly-review" | "narrative" | "usage" | "audit" | "sensitive" | "agent" | "accelerate" | "skills" | "team";
export type SettingsTab = "data-sources" | "data-control" | "ai-assistance" | "ai-usage" | "notifications" | "account";
export type WindowMode = "large" | "compact";
export type PrimarySection = "today" | "week" | "history";

export interface AppActionResult {
  ok: boolean;
  message: string;
}

export interface AgentChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  analysisSummary?: string;
  /** Set when a stream failed mid-response so the UI can offer a Retry affordance. */
  interrupted?: boolean;
}
