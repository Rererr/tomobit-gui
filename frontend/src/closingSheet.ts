// アプリの×の締めを1枚に集めるための整形 (ADR-0012 Decision 1)。
//
// 窓ごとのフックが持っている締めの断面と、格子に並んでいる窓の一覧から、
// 縦に並べるセクションの表示モデルを作る。ここに描画は無い — 「どの窓を、
// どの順で、何を添えて出すか」だけが決まる。
//
// 見出しに引くのは既にある事実だけ: 働く場所と、その窓の最初のユーザー発言。
// 本体がセッションの intent を最初の user 行から作るのと同じ発想で、GUI は
// 要約を発明しない（ADR-0005 Decision 2 の線をそのまま伸ばす）。

import type { main } from "../wailsjs/go/models";
import type { BoundaryQuestion } from "./boundaryChoices";
import type { ChatMessage, UserMessage } from "./types";

/** 1つの窓の締めの断面のうち、セクションの整形が読むぶん。 */
export interface ClosingSnapshot {
  /** 締めが終わった（chat:exit が届いた）。 */
  done: boolean;
  /** 今答えるべき問い。null は「器官が走っている最中で、まだ問いが来ていない」 */
  question: BoundaryQuestion | null;
  /** 締めの途中で本体が喋った行（Tomoの一言・知覚の報告など）。古い順 */
  notes: string[];
  /** その窓の最初のユーザー発言。"" は無し */
  firstUserSay: string;
}

/** 断面 + 答える口。App が窓ごとに持ち、1枚からの操作をこの口へ返す。 */
export interface PaneClosing extends ClosingSnapshot {
  answer: (send: string) => void;
  abandon: () => void;
}

export interface ClosingSection {
  paneId: string;
  /** その窓の働く場所（生のパス）。"" は未設定 — 見出しの言葉は描画側が決める */
  workingDir: string;
  /** 見出しに添える引用。"" なら引用ごと省く */
  quote: string;
  notes: string[];
  /** 今答えるべき問い。締めが終わった窓では常に null */
  question: BoundaryQuestion | null;
  done: boolean;
}

/** その窓の最初のユーザー発言。1度も送っていない窓では ""。 */
export function firstUserSay(messages: ChatMessage[]): string {
  return messages.find((m): m is UserMessage => m.kind === "user")?.text ?? "";
}

/**
 * 締めの走っている窓ぶんのセクションを、格子と同じ並びで作る。
 *
 * panes を軸に回すのは、並びの正本が保存された窓の一覧だから (ADR-0012
 * Decision 1: 順序は panes の並び)。断面の Map を軸にすると、到着順や
 * 挿入順という画面と無関係なものが縦の並びを決めてしまう。
 */
export function closingSections(
  panes: main.PaneConfig[],
  closings: ReadonlyMap<string, ClosingSnapshot>,
): ClosingSection[] {
  const sections: ClosingSection[] = [];
  for (const pane of panes) {
    const closing = closings.get(pane.id);
    if (closing === undefined) {
      // 締めが走っていない窓は載せない (ADR-0012 Decision 2)。1枚の裏に
      // 隠れるだけの窓に、来ない答えを待つ席を作らない。
      continue;
    }
    sections.push({
      paneId: pane.id,
      workingDir: (pane.working_dir ?? "").trim(),
      quote: closing.firstUserSay,
      notes: closing.notes,
      // 締めが終わった窓に未回答の問いを残さない: 相手のプロセスはもう居らず、
      // ボタンを押しても SendLine が新しい chat を起こすだけで、答えは締めの
      // どこにも届かない。
      question: closing.done ? null : closing.question,
      done: closing.done,
    });
  }
  return sections;
}
