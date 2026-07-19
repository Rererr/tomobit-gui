export type PaneId = "chat" | "settings" | "memory";

export type StreamChannel = "stdout" | "stderr";

/** chatストリームのひと切れ。同一チャネルの連続チャンクは結合して保持する */
export interface StreamSegment {
  channel: StreamChannel;
  text: string;
}

export interface UserMessage {
  id: string;
  kind: "user";
  text: string;
}

/** Tomo側の吹き出し = 次のユーザー送信までの子プロセス出力ストリーム全体 */
export interface TomoMessage {
  id: string;
  kind: "tomo";
  segments: StreamSegment[];
}

/** GUI自身の注記（区切りの宣言・プロセス終了・送信失敗）。会話ではない */
export interface SystemMessage {
  id: string;
  kind: "system";
  text: string;
}

export type ChatMessage = UserMessage | TomoMessage | SystemMessage;
