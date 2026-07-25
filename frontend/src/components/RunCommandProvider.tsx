import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { main } from "../../wailsjs/go/models";

// チャット内のコマンド実行ボタン (ADR-0007) が要る2つの事実 —— 有効かどうかと、
// どこで走るか —— を Markdown の奥まで運ぶ器。
//
// なぜ props で降ろさないか: 実行ボタンが要るのは Markdown の中の CodeBlock で、
// そこへは App → ChatPane → MessageView → Markdown → CodeBlock と4段ある。
// しかも同じ MessageView を過去表示 (SessionPane) も通る。途中の4つは
// このトグルに何の関心も無いので、全員に引数を1本ずつ足すと「知らなくていい
// ことを知っているコンポーネント」が4つ増える。
//
// 既定は「無効・走らせる先なし」。Provider を置き忘れた経路でボタンが出る、
// という向きの事故が起きない側を既定にする（ADR-0007 Decision 1 と同じ姿勢で、
// 沈黙は同意ではない）。

export interface RunCommandContextValue {
  /** 設定 (gui.json の run_command) が明示 ON か。false ならボタンを出さない */
  enabled: boolean;
  /** 走らせる場所。"" は未設定＝GUIプロセスの継承先 (ADR-0004 Decision 1) */
  workingDir: string;
  /** 実際に走らせる。Go 側 App.RunCommand を呼ぶ */
  run: (command: string) => Promise<main.CommandRun>;
}

const disabled: RunCommandContextValue = {
  enabled: false,
  workingDir: "",
  run: () => Promise.reject(new Error("コマンド実行が配線されていない")),
};

const RunCommandContext = createContext<RunCommandContextValue>(disabled);

export function RunCommandProvider({
  value,
  children,
}: {
  value: RunCommandContextValue;
  children: ReactNode;
}) {
  return <RunCommandContext.Provider value={value}>{children}</RunCommandContext.Provider>;
}

export function useRunCommand(): RunCommandContextValue {
  return useContext(RunCommandContext);
}
