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

/** 判断エンジン(本体 ADR-0012)が比較した候補1件。wins:-1 はゲート未通過で
 *  トーナメント不参加を意味する（本体 ADR-0040） */
export interface DecidedCandidate {
  provider: string;
  scope: string;
  quantile: number;
  passed: boolean;
  wins: number;
}

/** `decided` view イベント（本体 ADR-0040 Decision 1）。tomo.decided 記帳と
 *  同一内容 — 「なぜこのProviderか」の監査行そのもの */
export interface DecidedEvent {
  sid: string;
  provider: string;
  n: number;
  q: number;
  fallback: boolean;
  seed: string;
  candidates: DecidedCandidate[];
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
  // sid が一致する task.started に紐付いた decided のみ載る（本体 ADR-0040）。
  // 旧本体・do 経由など decided が無い経路では常に undefined —
  // 開示トグルの非表示はこのフィールドの有無だけで決まる。
  decided?: DecidedEvent;
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

export function asBoolean(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function asDecidedCandidate(v: unknown): DecidedCandidate | undefined {
  if (typeof v !== "object" || v === null) {
    return undefined;
  }
  const c = v as Record<string, unknown>;
  const provider = asString(c.provider);
  const scope = asString(c.scope);
  const quantile = asNumber(c.quantile);
  const passed = asBoolean(c.passed);
  const wins = asNumber(c.wins);
  if (
    provider === undefined ||
    scope === undefined ||
    quantile === undefined ||
    passed === undefined ||
    wins === undefined
  ) {
    return undefined;
  }
  return { provider, scope, quantile, passed, wins };
}

/** `decided` イベントを ViewEvent から絞り込む。1件でも不正な candidate が
 *  あれば全体を undefined にする — 半端な監査行を表示するより黙って
 *  トグルを出さない方が誤解を招かない（本体 ADR-0032 の未知フィールド耐性
 *  と同じ姿勢）。 */
export function asDecidedEvent(ev: ViewEvent): DecidedEvent | undefined {
  const sid = asString(ev.sid);
  const provider = asString(ev.provider);
  const n = asNumber(ev.n);
  const q = asNumber(ev.q);
  const fallback = asBoolean(ev.fallback);
  const seed = asString(ev.seed);
  if (
    sid === undefined ||
    provider === undefined ||
    n === undefined ||
    q === undefined ||
    fallback === undefined ||
    seed === undefined ||
    !Array.isArray(ev.candidates)
  ) {
    return undefined;
  }
  const candidates: DecidedCandidate[] = [];
  for (const raw of ev.candidates) {
    const candidate = asDecidedCandidate(raw);
    if (candidate === undefined) {
      return undefined;
    }
    candidates.push(candidate);
  }
  return { sid, provider, n, q, fallback, seed, candidates };
}
