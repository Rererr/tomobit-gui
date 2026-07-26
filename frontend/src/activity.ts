import type { ViewEvent } from "./types";

/** types.ts の asString と同じ絞り込み。ここが値を import しないのは、
 *  この module を node --test が拡張子付きの解決なしで読めるようにするため
 *  （型の import は消えるが、値の import は実行時に解決されてしまう）。 */
function providerOf(ev: ViewEvent): string {
  return typeof ev.provider === "string" ? ev.provider : "";
}

/**
 * 「Tomoが動いている」ことの状態 (ADR-0008)。
 *
 * 本体の view ストリームは、進捗があるときしか喋らない — 知覚も判断も
 * Provider の起動も、済むまでは1行も流れない。そのあいだ画面は前のターンの
 * ままで、送った本人からは窓が固まったのと区別がつかない。ここはその沈黙に
 * 「何を待っているか」を与える器で、新しい真実は作らない: 段が動く合図は
 * すべて契約（本体 ADR-0032）のイベントから導く。
 */
export type ActivityPhase =
  /** 送ったが、まだターンが開いていない（知覚・判断・Provider起動のあいだ） */
  | "requested"
  /** ターンが開いている = Provider が走っている */
  | "running"
  /** 区切り（/exit）の尾部 — Feedback → 知覚 → 質問 → 鏡 が走っている */
  | "closing";

export interface Activity {
  phase: ActivityPhase;
  /** 判断が決まっていれば Provider 名。まだ分からなければ "" */
  provider: string;
  /** この段に入った時刻(ms epoch)。経過の表示だけに使う */
  since: number;
  /**
   * 次の `ready` を1度だけ読み飛ばす。初回送信では子プロセスの起動がこちらの
   * 送信の後に来るので、開いたばかりのストリームは「まだ読んでいない行」を
   * 前にして ready を出す — それを人の番と読むと、一番長い沈黙（知覚・判断・
   * Provider 起動）がまるごと空白になる。`init` を見た時だけ立てる。
   */
  swallowReady: boolean;
}

export function startActivity(phase: ActivityPhase, now: number): Activity {
  return { phase, provider: "", since: now, swallowReady: false };
}

/**
 * view イベント1件で状態を進める。null は「待つものが無い＝人の番」。
 *
 * 終わりの合図を `ready`（入力待ち。本体 ADR-0032 の語彙でプロンプトマーカーの
 * 代替）と await 付き note に置くのが要で、`turn.finished` では終わらせない —
 * ターンが閉じた後も本体は喋りうるし、split の fold-back では次のターンが続く。
 * 「Tomoが黙っている」と「人が答える番」は別の事実で、後者だけが契約に載っている。
 *
 * 未知の type は current をそのまま返す（契約: 消費者は未知の type を無視せよ）。
 */
export function advanceActivity(current: Activity | null, ev: ViewEvent, now: number): Activity | null {
  switch (ev.type) {
    case "init":
      // ストリームが開いた = このプロセスは今起きたところ。直後の ready は
      // こちらが既に書いた行を読む前のプロンプトなので、1度だけ飲む。
      return current === null ? null : { ...current, swallowReady: true };
    case "ready":
      // 本体がプロンプトに立った = こちらの番。
      return current !== null && current.swallowReady ? { ...current, swallowReady: false } : null;
    case "task.finished":
    case "task.cancelled":
      // 境界の器官まで済んだ。ready を出さずに終わる経路（/exit）の受け皿。
      return null;
    case "note":
      // await の note は入力を待って書かれた行 = 答える番（本体 ADR-0032）。
      // それ以外の note は器官の発話で、待ちは続いている。
      return ev.await === true ? null : current;
    case "decided": {
      // 判断が決まった（本体 ADR-0040）。段は変えず、待っている相手の名前だけ
      // 分かるようになる — since は据え置き（同じ待ちの続きなので数え直さない）。
      const provider = providerOf(ev);
      if (current === null || provider === "") {
        return current;
      }
      return { ...current, provider };
    }
    case "turn.started": {
      // 送信を経ずに始まったターン（本体が自分から開いた場合）でも段は立てる。
      const provider = providerOf(ev);
      return {
        phase: "running",
        provider: provider !== "" ? provider : (current?.provider ?? ""),
        since: now,
        // ターンが始まった以上、読み飛ばす理由（未読の行）はもう無い。
        swallowReady: false,
      };
    }
    default:
      return current;
  }
}

export function activityLabel(a: Activity): string {
  const phase = a.phase === "requested" ? "依頼中" : a.phase === "running" ? "実行中" : "区切り中";
  // Provider 名は分かったときだけ足す。区切りの尾部は本体の器官の仕事で、
  // Provider の実行ではないので名前を出さない。
  return a.phase !== "closing" && a.provider !== "" ? `${phase} · ${a.provider}` : phase;
}

/** 待ちの長さ。1分を超えたら分を出す（秒だけの3桁は読みにくい） */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60);
  return m === 0 ? `${s}s` : `${m}m${String(s).padStart(2, "0")}s`;
}
