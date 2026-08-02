/**
 * 返答の隣に置く反応 (GUI ADR-0014 Decision 4 / 本体 ADR-0057)。
 *
 * ここが持つのは**形と規則だけ**で、語彙は持たない。本体が `init` で配る
 * `{word,label}` をそのまま使い、GUI が持つのは word → 記号の対応1枚に留める
 * （本体が語を足した日に、口が消えも化けもしないため）。
 *
 * ライブ（useChatSession）と過去の再生（viewFold）が同じ規則で動くように、
 * 両方がこの1つを通す（SubtaskFrames と同じ配置理由）。枠の実体はライブが
 * メッセージ id、再生が配列 index と違うので、参照の型は呼び出し側が決める。
 *
 * 型だけの依存で閉じてある — このリポジトリで node --test が読めるモジュールは、
 * ランタイムの import を持たないものに限られる（permission.ts と同じ理由）。
 */

/** 本体が `init` で配る語彙1つ (本体 ADR-0057 Decision 3)。 */
export interface ReactionWord {
  word: string;
  label: string;
}

/**
 * 置いたものの取り消し。**本体は `init` でこれを配らない** — 語ではなく操作で、
 * どの消費者も「置いたものを外す」という同じ1つの手しか持たないからである
 * (本体 ADR-0057 Decision 3)。だからこの1語だけは GUI 側が名前を知っている。
 */
export const REACTION_CLEAR = "clear";

/**
 * GUI が持ってよい唯一の語彙依存: word → 記号。ラベル文は本体のものを使う。
 *
 * Why not 知らない word にも記号を割り当てるか: 本体が語を足した日に、GUI が
 * 勝手な記号で別の意味を名乗ることになる。知らない語は本体のラベル文字を
 * そのまま出す（ADR-0014 Decision 4）。
 */
const REACTION_MARKS: Record<string, string> = {
  up: "👍",
  meh: "🤔",
  down: "👎",
};

/** 画面に出す1文字ぶん。記号を知らない語は、本体のラベル文字（無ければ語）をそのまま。 */
export function reactionGlyph(word: string, vocabulary: ReactionWord[] | null): string {
  const mark = REACTION_MARKS[word];
  if (mark !== undefined) {
    return mark;
  }
  return reactionLabel(word, vocabulary);
}

/** 読み上げと `title` に出す文。語彙に無ければ語そのものを言う（黙るよりは名乗る）。 */
export function reactionLabel(word: string, vocabulary: ReactionWord[] | null): string {
  return vocabulary?.find((v) => v.word === word)?.label ?? word;
}

/** 本体へ送る1行。`/react <turn> <word>` (本体 ADR-0057 Decision 1)。 */
export function reactionLine(n: number, word: string): string {
  return `/react ${n} ${word}`;
}

/**
 * messages[index] が「会話の最後のターン」か（ADR-0014 Decision 4「会話の末尾の
 * メッセージだけは、ホバー無しでも出す」の判定そのもの）。
 *
 * Why not CSS の `:last-child`: 会話ログの末尾には、ターンの後に境界の器官の
 * note・GUI 自身の system 注記・stderr・走行中の帯（ActivityIndicator）が
 * 来うる。ターンの後に note が1つ届くだけで DOM 上の最後の子要素が入れ替わり、
 * 直前まで見えていた反応ボタンが消える（実機で再現済み。境界の器官は毎ターン
 * note を出すので稀なケースではない）。`:has()` / `:not(:has(~ .foo))` で
 * 隣接兄弟を辿れば書けなくはないが、実機は WKWebView・検証は Chromium で
 * engine 差が出る新しいセレクタに規則を預けない（`<summary>` のマーカーを
 * 自前化したのと同じ理由）。規則は TypeScript 側に置き、node --test から
 * 読める形にする（呼び出し側が結果を `chat-turn-reactions--latest` という
 * 1クラスへ落とし、CSS はそのクラスだけを見る）。
 *
 * 型を `ChatMessage` ではなく構造的な `{ kind: string }` で受けるのは、この
 * ファイルがランタイムの import を持たないモジュールであることを型でも保証する
 * ため（ファイル冒頭の説明のとおり）。
 */
export function isLatestTurn(messages: ReadonlyArray<{ kind: string }>, index: number): boolean {
  if (messages[index].kind !== "turn") {
    return false;
  }
  for (let i = index + 1; i < messages.length; i++) {
    if (messages[i].kind === "turn") {
      return false;
    }
  }
  return true;
}

/**
 * 本体が記帳した語を、枠に残す印へ写す。`clear` は「置かれていない」へ戻す —
 * 取り消しは「答えない」であって「答えた」ではない（本体 ADR-0057 Decision 2）。
 */
export function confirmedReaction(word: string): string | undefined {
  return word === REACTION_CLEAR ? undefined : word;
}

/** ターン枠に残る印。pending は「送るつもりの語」で、確定した reaction の手前に立つ。 */
export interface ReactionMark {
  reaction?: string;
  reactionPending?: string;
}

/**
 * その語のボタンの状態。
 *
 * `placing` / `clearing` は**本体の記帳待ち**で、置いた印とは見分けが付く姿で
 * 描く（押した通りには描かない — GUI ADR-0010 Decision 3 と同じ規律）。
 * 別の語へ差し替え中の古い語が `idle` に落ちるのは、外れる側だからである。
 */
export type ReactionState = "idle" | "placed" | "placing" | "clearing";

export function reactionState(mark: ReactionMark, word: string): ReactionState {
  const pending = mark.reactionPending;
  if (pending !== undefined) {
    if (pending === word) {
      return "placing";
    }
    if (pending === REACTION_CLEAR && mark.reaction === word) {
      return "clearing";
    }
    return "idle";
  }
  return mark.reaction === word ? "placed" : "idle";
}

/**
 * タスク1つぶんの「ターン番号 → 枠」の表。
 *
 * 台帳の n は**タスクごとに1から振り直される**（本体 ADR-0022 Decision 1:
 * セッション=タスク、ターンはその中の呼吸）。同じ窓のログには区切りを跨いで
 * 複数タスクのターンが並ぶので、n だけをキーにすると別タスクのターンへ印が付く。
 *
 * `sub` を持つ枠は入れない: 分割の子は経験を持たない（本体 ADR-0054）ので、
 * 反応を置いても効く先が無い（GUI ADR-0014 Decision 4）。
 */
export class TurnIndex<T> {
  private readonly byN = new Map<number, T>();

  /** タスクが変わった。前のタスクのターンにはもう置けない。 */
  reset(): void {
    this.byN.clear();
  }

  /**
   * 会話そのもののターンが始まった。**同じ n が繰り返されたら後から来た枠を採り、
   * 置き換えた前の枠を返す**（何も置き換えていなければ null）。
   *
   * Why not 最初の枠を採るか: 同じ n が繰り返されるのは分割の畳み戻し
   * （本体 ADR-0028/0030）で、**2つ目の枠こそが結論**である —— 1つ目は
   * 「分割して走らせる」というアナウンスで、人が読んで反応したいのは
   * 親Providerが統合した報告の方。先勝ちにすると、結論の枠には口も印も
   * 出ないまま、アナウンスの枠にだけボタンが立つ。
   *
   * 返り値で前の枠を渡すのは、**印を移す**のは呼び出し側だからである（枠の実体が
   * ライブはメッセージ id、再生は配列 index と違う）。移さずに置き換えると、
   * 既に置いた印が画面から消える。
   */
  start(n: number, ref: T): T | null {
    const previous = this.byN.get(n);
    this.byN.set(n, ref);
    return previous === undefined || previous === ref ? null : previous;
  }

  /** その番号の枠。いまのタスクに無ければ null。 */
  target(n: number): T | null {
    return this.byN.get(n) ?? null;
  }

  /** いまのタスクの枠すべて。「反応を置ける枠」の集合そのもの。 */
  refs(): T[] {
    return [...this.byN.values()];
  }

  /**
   * いまのタスクの、keep 以外の枠すべて。
   *
   * 締めが読むのは**そのタスクの最後の1件だけ**（本体 ADR-0057 Decision 2）
   * なので、画面に見える印もタスクにつき高々1つでなければならない —— 3ターン目の
   * 👍 と7ターン目の 👎 が同時に見えている画面は、記録される内容について嘘をつく。
   * 記帳が返った枠以外はここで降ろす。
   *
   * 前のタスクの枠は入っていない（reset 済み）。区切りの向こう側の印は
   * その**タスクの答え**なので、降ろすと別のタスクの記録を消したことになる。
   */
  others(keep: T): T[] {
    return [...this.byN.values()].filter((ref) => ref !== keep);
  }
}

/**
 * 反応の口を画面の奥まで運ぶ器の中身（components/ReactionProvider が配る）。
 *
 * 既定は「語彙なし・置ける枠なし」= 読み取り専用。過去セッション (SessionPane) は
 * これを配らないので、**印は見えるが置けない**という ADR-0014 Decision 5 が
 * 配線ではなく既定値で成立する。
 */
export interface ReactionPort {
  /** 本体が `init` で配った語彙。null は配られなかった＝口を出さない */
  vocabulary: ReactionWord[] | null;
  /** 反応を置ける枠の id（いま開いているタスクの、会話そのもののターン） */
  placeable: ReadonlySet<string>;
  /** 押した。送るのは口が空いてから（溜める判断は呼ばれた先が持つ） */
  react: (n: number, word: string) => void;
}

/** 送る口が空いているかの判定に要る、いまの窓の状態。 */
export interface MouthState {
  /** 待ちの帯が立っている (ADR-0008) = Tomo が走っている */
  running: boolean;
  /** 権限の問いが立っている (本体 ADR-0053) */
  permissionAsked: boolean;
  /** 区切りの器官が答えを待っている */
  boundaryActive: boolean;
  /** 窓の×が始めた締めの最中 (ADR-0005) */
  closing: boolean;
}

/**
 * 反応を送ってよい時か (ADR-0014 Decision 4「問いが立っている間は送らない」)。
 *
 * 本体のチャットは**1本の stdin を順に読む**。走行中に書いた行はパイプに溜まり、
 * 次に本体が行を読む場所 —— それは権限の問い (ADR-0053) や境界の器官でもある ——
 * で**答えとして消費される**。反応も権限も、両方が消える。
 */
export function canSendReaction(mouth: MouthState): boolean {
  return !mouth.running && !mouth.permissionAsked && !mouth.boundaryActive && !mouth.closing;
}

/** 送るのを待っている反応1件。 */
export interface PendingReaction {
  n: number;
  word: string;
}

/**
 * 送れるまで反応を溜める場所 (ADR-0014 Decision 4)。
 *
 * Why not 動いている間はボタンを消すか: 押せる時と押せない時があるものは、
 * 押せない時に理由を訊かれる。溜めるなら、人は押した瞬間のことだけ考えればよい。
 */
export class ReactionOutbox {
  private readonly byTurn = new Map<number, string>();
  /**
   * 送ったが、本体の記帳（`reaction` イベント）がまだ返っていないターン。
   *
   * 溜め場から抜けた反応も、記帳が返るまでは**画面では送信待ちのまま**である。
   * ここで数えていないと、宛先が消えた時に「まだ送っていないぶん」しか数えられず、
   * 送信済み・未記帳の反応が**1行も言われずに消える**（押した人にとっては
   * 「置いた」ままなのに）。
   */
  private readonly inFlight = new Set<number>();
  /** 送信ループが走っているか（drainOutbox の再入ガード）。 */
  private draining = false;

  /**
   * 置く。**同じターンへの連打は最後の1つだけ**を残す —— キューを積み上げると、
   * 口が空いた瞬間に同じターンへの行が何本も流れ、台帳が指の震えを記録する。
   *
   * 既存のキーを一度消してから入れ直すのは、`Map.set` が**既存キーの挿入順を
   * 更新しない**からである。押し直したターンが古い位置に残ると、送る順が押した順と
   * 逆転し、本体が「最後に届いた1件」を締めの答えにする（本体 ADR-0057 Decision 2）
   * ため、**画面と台帳が食い違う**。
   */
  place(n: number, word: string): void {
    this.byTurn.delete(n);
    this.byTurn.set(n, word);
  }

  /**
   * 口が空いていれば次の1件を取り出す（押された順）。塞がっていれば溜めたまま null。
   *
   * 1件ずつなのは、送信の途中で口が塞がりうるから（await のあいだに権限の問いが
   * 立つ）。呼び出し側は毎回この判定を通り直す。
   */
  next(mouth: MouthState): PendingReaction | null {
    if (!canSendReaction(mouth)) {
      return null;
    }
    for (const [n, word] of this.byTurn) {
      this.byTurn.delete(n);
      this.inFlight.add(n);
      return { n, word };
    }
    return null;
  }

  /** 記帳が返った、あるいは送れなかった。宙に浮いていたぶんを降ろす。 */
  settle(n: number): void {
    this.inFlight.delete(n);
  }

  /**
   * 宛先が消えた（タスクが区切られた・プロセスが終わった）。捨てた枠の番号を返す。
   *
   * **まだ送っていないぶんと、送ったが記帳が返っていないぶんの両方**を数える。
   * 本体が断った反応は view に来ないので、後者は放っておくと永遠に記帳を待つ姿で
   * 固まる —— 呼び出し側はこの件数で「黙って捨てなかった」ことを言う。
   */
  drop(): number[] {
    const ns = [...new Set([...this.byTurn.keys(), ...this.inFlight])];
    this.byTurn.clear();
    this.inFlight.clear();
    return ns;
  }

  /** 送信ループの入口（drainOutbox 専用）。既に走っていれば false。 */
  beginDrain(): boolean {
    if (this.draining) {
      return false;
    }
    this.draining = true;
    return true;
  }

  /** 送信ループの出口（drainOutbox 専用）。 */
  endDrain(): void {
    this.draining = false;
  }
}

/** 1件送る口。送れなかったら false を返す（そこで流すのをやめる）。 */
export type ReactionSender = (n: number, word: string) => Promise<boolean>;

/**
 * 溜まっている反応を、口が空いているあいだだけ流す (ADR-0014 Decision 4)。
 *
 * 1件ごとに口を判定し直すのは、await のあいだに塞がりうるから —— 送信中に
 * 権限の問いが立てば、残りは次に空いた時まで溜めたままにする。
 *
 * 再入ガードが要るのは、押下と「口が空いた」の両方がこれを呼ぶからである。
 * ガードが無いと2本のループが同じ溜め場から交互に取り出し、await のあいだに
 * 入ったもう1本が同じ行を続けて送る。ガードを溜め場側に置いてあるのは、
 * 窓ごとに溜め場が別だから —— モジュールに1つ持つと、窓が2つある日に
 * 片方の送信がもう片方を黙らせる。
 */
export async function drainOutbox(
  outbox: ReactionOutbox,
  mouth: () => MouthState,
  send: ReactionSender,
): Promise<void> {
  if (!outbox.beginDrain()) {
    return;
  }
  try {
    for (;;) {
      const item = outbox.next(mouth());
      if (item === null) {
        return;
      }
      if (!(await send(item.n, item.word))) {
        // 送れなかったものは記帳を待たない。呼び出し側が印を降ろす。
        outbox.settle(item.n);
        return;
      }
    }
  } finally {
    outbox.endDrain();
  }
}
