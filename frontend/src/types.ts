export type PaneId = "chat" | "settings" | "memory";

export type ChatRole = "user" | "tomo";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
}
