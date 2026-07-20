export type PaneId = "chat" | "settings" | "memory" | "session";

export type StreamChannel = "stdout" | "stderr";

/** Tomo のターン内の要素（本体 ADR-0032 の view イベントから構成する） */
export type TurnBlock =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; detail?: string }
  | { kind: "tool_result"; text: string }
  | { kind: "error"; message: string };

export interface UserMessage {
  id: string;
  kind: "user";
  text: string;
}

/** ひとつの turn.started〜turn.finished を1枠として表す。fold-back のフィード
 *  ターンは親と同じ n を繰り返すが、入れ子にせず別枠として順に並べる */
export interface TurnMessage {
  id: string;
  kind: "turn";
  n: number;
  provider: string;
  blocks: TurnBlock[];
  finished?: { durationMs: number; costUsd?: number };
}

/** ターン外の器官の発話・注記。await は境界の Feedback 質問（入力欄で答える対象） */
export interface NoteMessage {
  id: string;
  kind: "note";
  text: string;
  await: boolean;
}

/** GUI自身の注記（区切りの宣言・プロセス終了・送信失敗）。会話ではない */
export interface SystemMessage {
  id: string;
  kind: "system";
  text: string;
}

/** stderr = 本体の警告・エラー。契約外の人間向け診断（連続チャンクは結合して保持） */
export interface StderrMessage {
  id: string;
  kind: "stderr";
  text: string;
}

export type ChatMessage = UserMessage | TurnMessage | NoteMessage | SystemMessage | StderrMessage;

/** chat:view で届く NDJSON view イベント。type だけを保証し、値は unknown から
 *  型ガードで絞る（未知の type は無視 — 本体 ADR-0032 の契約） */
export interface ViewEvent {
  type: string;
  [key: string]: unknown;
}

export function isViewEvent(v: unknown): v is ViewEvent {
  return typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";
}

export function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function asNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
