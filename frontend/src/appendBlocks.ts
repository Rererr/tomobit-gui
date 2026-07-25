// ストリーム到着の一括反映 (2026-07-26 の応答停止への修正)。
//
// 事故の形: 本体は本文を細切れの text で流す。到着1件ごとに setMessages して
// いたため、1チャンクにつき「メッセージ配列全体の複製 + ログ全体の再描画 +
// scrollIntoView による同期レイアウト」が走っていた。1件あたり O(メッセージ数
// × ブロック数)。104件のツール呼び出しを含む26分の単一ターンでこれが二次曲線に
// 乗り、WebView のメインスレッドが飽和して窓が応答を返さなくなった。
//
// 直し方: 到着はバッファへ積むだけにして、フレームに1回だけまとめて反映する
// (App.tsx の appendBlock)。この関数はその「まとめて反映」の純粋な中身で、
// 何件積まれていてもメッセージ配列の複製は1回、対象ターンのブロック配列の
// 複製も1回に閉じる。
import type { ChatMessage, TurnBlock } from "./types";

// 連続する text ブロックはひとつに結合する（本体は本文を細切れの text で流す）。
// 破壊的に扱ってよいのは呼び出し側が新しく確保した配列だけなので、この関数は
// appendBlocksTo の中でだけ使う。
function pushMerged(blocks: TurnBlock[], block: TurnBlock): void {
  const last = blocks[blocks.length - 1];
  if (block.kind === "text" && last !== undefined && last.kind === "text") {
    blocks[blocks.length - 1] = { kind: "text", text: last.text + block.text };
    return;
  }
  blocks.push(block);
}

/**
 * 溜まったブロックを、id が openId のターンへまとめて追記する。
 *
 * 位置ではなく id で当てるので、追記の間に note や stderr が挟まっても
 * ターンの並び順は動かない —— 溜めたぶんを後から流し込んでも、会話の順序は
 * 到着順のまま保たれる。
 *
 * openId のターンが配列に無ければ（turn.started より先にブロックが来た契約
 * 違反、または最初のフラッシュ）末尾に新しいターンを開いて受ける。落として
 * 黙るより、n/provider が不明なまま出す方がいい。
 *
 * incoming が空なら messages をそのまま返す（同一参照）—— 呼び出し側の
 * 「積まれていなければ何もしない」を、ここでも二重に保証する。
 */
export function appendBlocksTo(
  messages: ChatMessage[],
  openId: string | null,
  incoming: TurnBlock[],
): ChatMessage[] {
  if (incoming.length === 0) {
    return messages;
  }
  const index = openId === null ? -1 : messages.findIndex((m) => m.id === openId && m.kind === "turn");
  if (index === -1) {
    const blocks: TurnBlock[] = [];
    for (const block of incoming) {
      pushMerged(blocks, block);
    }
    return [...messages, { id: openId ?? "msg-orphan", kind: "turn", n: 0, provider: "", blocks }];
  }
  const target = messages[index] as ChatMessage & { kind: "turn" };
  const blocks = target.blocks.slice();
  for (const block of incoming) {
    pushMerged(blocks, block);
  }
  const next = messages.slice();
  next[index] = { ...target, blocks };
  return next;
}
