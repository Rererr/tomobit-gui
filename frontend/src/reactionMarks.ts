/**
 * ライブの会話ログに反応の印を書く規則 (ADR-0014 Decision 4)。
 *
 * useChatSession が `setMessages` の中で呼ぶ純関数だけを置く。フックの中から
 * ここへ出したのは、**中核の不変条件を React 抜きで確かめられるようにするため**
 * である —— 規則がフックに書かれていた頃、「自分以外の枠の印を降ろす」処理を
 * 丸ごと外しても `tsc --noEmit` も `node --test` も1つも赤くならなかった（変異
 * 試験で確認）。純粋関数層 (reaction.ts) と再生層 (viewFold.ts) には試験があった
 * のに、**実際に人が押す配線層にだけ1本も無かった**。
 *
 * 枠を id で当てるのはライブの都合で、過去の再生 (viewFold) は配列 index で
 * 当てる。共有するのは TurnIndex までにしてある（reaction.ts の「枠の実体は
 * 呼び出し側が決める」）—— 器の違うものを1つの関数へ押し込むと、どちらの都合でも
 * ない引数が増える。
 *
 * どの関数も**何も変わらなければ同じ配列を返す**。ログ全体の作り直しは
 * MessageView の浅い比較を全部空振りさせる（2026-07-26 の応答停止の境界）。
 */
import type { ChatMessage, TurnMessage } from "./types";
import type { ReactionMark, TurnIndex } from "./reaction";
// ランタイムの import にだけ拡張子を付ける（types.ts / viewFold.ts と同じ理由 ——
// node --test は拡張子無しの相対 import を解決しない）。
import { confirmedReaction } from "./reaction.ts";

/** n の枠に送信待ちを書く／降ろす。id が判らない（いまのタスクに無い）番号は黙って捨てる。 */
export function markTurn(
  messages: ChatMessage[],
  turns: TurnIndex<string>,
  n: number,
  mark: ReactionMark,
): ChatMessage[] {
  const id = turns.target(n);
  if (id === null) {
    return messages;
  }
  return messages.map((m) => (m.id === id && m.kind === "turn" ? { ...m, ...mark } : m));
}

/**
 * 本体が記帳した1件を画面へ写す。**いま開いているタスクの他の枠の印は降ろす。**
 *
 * 締めが読むのはそのタスクの最後の `user.reaction` 1件だけ（本体 ADR-0057
 * Decision 2）なので、3ターン目の 👍 と7ターン目の 👎 が同時に見えている画面は、
 * 記録される内容について嘘をつく。置き直せば印はそのターンへ移る —— どこで
 * 気が変わったかの履歴は台帳のイベント列が持っているので、失われない。
 *
 * Why not 押した瞬間に他の印を降ろすか: 送信が失敗した時、台帳にはまだ前の
 * 反応が残っているのに画面からだけ消えることになる（押した通りには描かない —
 * ADR-0010 Decision 3）。送信待ちが同時に2つ見えるのは許して、**確定した印**
 * だけを1つに保つ。破線の待ちは「置いた」ではなく「送っている」と読める姿で、
 * 記録された答えを名乗っていない。
 *
 * まだ溜め場に残っている別の枠の待ちも、ここで一度降ろす（見える印を1つに
 * 保つため）。それは送られ、記帳が返った時にその枠へ印が立つ —— 一瞬だけ
 * 待ちの姿が消えるが、印は必ず最後に押した枠へ着地する。
 */
export function applyConfirmedReaction(
  messages: ChatMessage[],
  turns: TurnIndex<string>,
  n: number,
  word: string,
): ChatMessage[] {
  const id = turns.target(n);
  if (id === null) {
    return messages;
  }
  const others = new Set(turns.others(id));
  return messages.map((m) => {
    if (m.kind !== "turn") {
      return m;
    }
    if (m.id === id) {
      return { ...m, reaction: confirmedReaction(word), reactionPending: undefined };
    }
    // 触らない枠は参照を保つ（MessageView の浅い比較を壊さない）。
    if (!others.has(m.id) || (m.reaction === undefined && m.reactionPending === undefined)) {
      return m;
    }
    return { ...m, reaction: undefined, reactionPending: undefined };
  });
}

/**
 * 送信待ちの印を全部降ろす（宛先が消えた: 区切り・プロセス終了）。
 *
 * 本体が断った反応は view に来ないので、残すと永遠に記帳を待つ姿で固まる。
 * 確定した印には触らない —— あれはそのタスクの答えとして記帳されている。
 */
export function clearPendingMarks(messages: ChatMessage[]): ChatMessage[] {
  if (!messages.some((m) => m.kind === "turn" && m.reactionPending !== undefined)) {
    return messages;
  }
  return messages.map((m) => (m.kind === "turn" && m.reactionPending !== undefined ? { ...m, reactionPending: undefined } : m));
}

/**
 * 新しいターン枠を末尾に開く。**replaced の枠に付いていた印と送信待ちは、
 * 開いた枠へ移す。**
 *
 * 同じ n が繰り返されたら宛先は後から来た枠になる（畳み戻しの結論が着地する枠
 * —— TurnIndex.start 参照）ので、移さないと**置いたはずの印が黙って消える**。
 */
export function openTurn(messages: ChatMessage[], opened: TurnMessage, replaced: string | null): ChatMessage[] {
  const carried =
    replaced === null
      ? undefined
      : messages.find((m): m is TurnMessage => m.id === replaced && m.kind === "turn");
  if (carried === undefined) {
    return [...messages, opened];
  }
  return [
    ...messages.map((m) =>
      m.id === replaced && m.kind === "turn" ? { ...m, reaction: undefined, reactionPending: undefined } : m,
    ),
    { ...opened, reaction: carried.reaction, reactionPending: carried.reactionPending },
  ];
}
