import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { ReactionPort } from "../reaction";

// 返答の隣に置く反応 (ADR-0014 Decision 4) が要る3つの事実 —— 本体が配った語彙・
// いま置ける枠・押した時の呼び先 —— を、会話の描画の奥まで運ぶ器。
//
// なぜ props で降ろさないか: 反応の口が要るのはターン枠の中で、そこへは
// App → ChatPaneHost → ChatPane → MessageView → TurnCard と5段ある。しかも同じ
// MessageView を過去表示 (SessionPane) も通る（ADR-0003 Decision 1: 単一の描画源）。
// 途中の4つはこの口に何の関心も無く、全員に引数を足すと「知らなくていいことを
// 知っているコンポーネント」が増える —— RunCommandProvider と同じ形の問題である。
//
// 既定は「語彙なし・置ける枠なし」= 読み取り専用。過去セッションは Provider を
// 置かないので、**印は見えるが置けない**（ADR-0014 Decision 5）が既定値で成立する。
// 配線を忘れた経路で口が出る、という向きの事故が起きない側を既定にする。

const readOnly: ReactionPort = {
  vocabulary: null,
  placeable: new Set(),
  react: () => {},
};

const ReactionContext = createContext<ReactionPort>(readOnly);

export function ReactionProvider({ value, children }: { value: ReactionPort; children: ReactNode }) {
  return <ReactionContext.Provider value={value}>{children}</ReactionContext.Provider>;
}

export function useReactionPort(): ReactionPort {
  return useContext(ReactionContext);
}
