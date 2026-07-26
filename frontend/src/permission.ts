import type { BoundaryQuestion } from "./boundaryChoices";

/** 本体が求めた道具1つと、それが触ろうとしたものの1行要約。 */
export interface PermissionTool {
  tool: string;
  detail: string;
}

/** モーダルが描くのに要るもの。文面も選択肢も本体由来で、GUI は形だけを持つ。 */
export interface PermissionRequest {
  tools: PermissionTool[];
  question: BoundaryQuestion;
}

/**
 * 本体の `{"type":"permission", ...}` を画面が使える形へ読む
 * （本体 ADR-0053 Decision 5 / ADR-0032 の view 契約）。
 *
 * **文面から種類を当てない。** type を見て判る形で本体が出しているのは、
 * GUI が語彙を持たないため（ADR-0005 Decision 2）— ここで「『許可』という語が
 * 入っていたら権限の問い」のような判定を書いた瞬間に、本体が文言を変えた日に
 * 黙って壊れる。
 *
 * 読めない形（tools が無い・空）は null を返す。モーダルは出ないので、
 * 問いは会話面の1行として残り、人は入力欄から答えられる — 答える道が
 * 完全に消える形にはしない。
 */
export function parsePermissionEvent(
  ev: Record<string, unknown>,
  // 問いのパースは注入で受ける。ここが boundaryChoices を直接 import しないのは、
  // 型だけの import は消えるがランタイムの import は消えないためで、テストが
  // このモジュール単体を読めなくなる（このリポの他のモジュールは他所を
  // import していないので、前例が無かった）。依存が1つ減るのは副産物。
  parseQuestion: (text: string) => BoundaryQuestion,
): PermissionRequest | null {
  const rawTools = ev.tools;
  if (!Array.isArray(rawTools) || rawTools.length === 0) {
    return null;
  }
  const tools: PermissionTool[] = [];
  for (const raw of rawTools) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const t = raw as Record<string, unknown>;
    const tool = typeof t.tool === "string" ? t.tool : "";
    if (tool === "") {
      continue;
    }
    tools.push({ tool, detail: typeof t.detail === "string" ? t.detail : "" });
  }
  if (tools.length === 0) {
    return null;
  }
  const text = typeof ev.text === "string" ? ev.text : "";
  const question = parseQuestion(text);
  if (question.choices.length === 0) {
    // 選択肢が読めないなら、ボタンを発明しない（GUI は語彙を持たない）。
    // 会話面の行として残り、入力欄から答えられる。
    return null;
  }
  return { tools, question };
}
