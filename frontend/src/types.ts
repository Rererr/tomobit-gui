import type { ReactionWord } from "./reaction";
// ランタイムの import にだけ拡張子を付ける（viewFold.ts と同じ理由 —— node --test は
// 拡張子無しの相対 import を解決しない。型ガードのテストがここを読む）。
import { REACTION_CLEAR } from "./reaction.ts";

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

/** `reaction` view イベント（本体 ADR-0057 Decision 3）。**本体が記帳した確認**
 *  であって、押した通りに描かないための唯一の根拠 — 断られた反応はここに来ない */
export interface ReactionEvent {
  n: number;
  word: string;
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
  /** 分割のサブタスクなら、その1始まりの通し番号と総数（本体 ADR-0032 の
   *  `sub` / `sub_total`）。並走すると複数の枠が同時に開くので、どの枠に本文を
   *  足すかは番号でしか決まらない。会話そのもののターンは持たない。 */
  sub?: number;
  subTotal?: number;
  /** 本体が記帳した反応の語 (本体 ADR-0057 / GUI ADR-0014 Decision 4)。
   *  `finished` / `decided` と同じくフィールドに置く — 印を配列や関数で外から
   *  配ると MessageView の浅い比較が壊れる（2026-07-26 の応答停止の境界）。 */
  reaction?: string;
  /** 送るつもりで溜めている語。本体の `reaction` が返るまでこちらが立つ —
   *  「送った」と「記帳された」を同じ見え方にしないための1フィールド。
   *  `clear` は「外そうとしている」。 */
  reactionPending?: string;
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

/** `{"type":"reaction","n":3,"word":"up"}` を絞り込む。読めない値は undefined に
 *  落とし、印は付けない — 半端な印は「押したのに違う所に付いた」に見える。
 *
 *  n は**正の整数だけ**を通す（本体 ADR-0057 Decision 1: ターン番号は1から振る）。
 *  0・負数・小数・NaN は本体が受け取らない値なので、通すと台帳に存在しない
 *  ターンの印を画面が名乗ることになる。 */
export function asReactionEvent(ev: ViewEvent): ReactionEvent | undefined {
  const n = asNumber(ev.n);
  const word = asString(ev.word);
  if (n === undefined || !Number.isInteger(n) || n < 1 || word === undefined || word === "") {
    return undefined;
  }
  return { n, word };
}

/**
 * `init` が配る反応の語彙（本体 ADR-0057 Decision 3）。
 *
 * **配られなければ null = 反応の口を出さない**（劣化は沈黙 — `decided` と同じ）。
 * 1件でも契約に合わない要素があれば全体を null にするのは asDecidedEvent と同じ
 * 姿勢で、半端な語彙を出すと**本体が受け付ける語のうち一部だけが押せる**口になる
 * —— 押せなかった語は、人からは「そんな反応は無い」と見える。
 *
 * 落とすのは読めない要素だけではない:
 * - **同じ word が2つ**: 同じ記号のボタンが2つ並び、React の key も重複する。
 *   どちらを押しても同じ行が飛ぶので、片方は「押しても何も変わらないボタン」になる
 * - **予約語 `clear`**: 本体は取り消しを語彙として配らない契約（Decision 3）。
 *   受け取ると「取り消し」が置ける反応の1つとして並び、押すと `/react n clear`
 *   —— 印を置いたつもりで印を外す口になる
 *
 * Why not その要素だけ落とすか: 契約から外れた `init` を「読める所まで読んだ」形で
 * 使うと、**GUI が本体の語彙を勝手に編集したことになる**（ADR-0014 Decision 4:
 * 語彙は本体のもの）。黙って口を消す方が、黙って別の語彙を名乗るより正直である。
 */
export function asReactionVocabulary(ev: ViewEvent): ReactionWord[] | null {
  if (!Array.isArray(ev.reactions)) {
    return null;
  }
  const words: ReactionWord[] = [];
  const seen = new Set<string>();
  for (const raw of ev.reactions) {
    if (typeof raw !== "object" || raw === null) {
      return null;
    }
    const r = raw as Record<string, unknown>;
    const word = asString(r.word);
    const label = asString(r.label);
    if (word === undefined || word === "" || label === undefined || label === "") {
      return null;
    }
    if (word === REACTION_CLEAR || seen.has(word)) {
      return null;
    }
    seen.add(word);
    words.push({ word, label });
  }
  return words.length === 0 ? null : words;
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
