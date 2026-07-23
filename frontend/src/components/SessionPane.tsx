import { useEffect, useState } from "react";
import { GetSessionDigest, GetSessionScrollback } from "../../wailsjs/go/main/App";
import type { main } from "../../wailsjs/go/models";
import type { ChatMessage } from "../types";
import { foldViewEvents } from "../viewFold";
import { Markdown } from "./Markdown";
import { MessageView } from "./ChatMessageView";
import { errorMessage } from "../errorMessage";

interface SessionPaneProps {
  sessionId: string;
}

// ヘッダ（開始時刻・状態）は常に台帳ダイジェストから取り、本文はスクロール
// バックが在れば全文、無ければダイジェストで描く（ADR-0003 Decision 1 の
// フォールバック）。header を全文モードでもダイジェストから引くのは、開始時刻・
// 状態が台帳の真実であり view ストリームから導くより正しいため。
type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; detail: main.SessionDetail; transcript: ChatMessage[] | null }
  | { kind: "error"; message: string };

/** 表示用に畳んだダイジェスト行。連続するTomo本文は1つの吹き出しに、
 * 連続する同名ツールは回数に集約する — 台帳の1イベント=1行のまま出すと
 * ツール行がダイジェストを埋めてしまう。 */
type ViewRow =
  | { kind: "user"; text: string; n: number }
  | { kind: "tomo"; text: string }
  | { kind: "tool"; name: string; count: number }
  | { kind: "provider"; text: string }
  | { kind: "error"; text: string };

function foldItems(items: main.DigestItem[]): ViewRow[] {
  const rows: ViewRow[] = [];
  for (const item of items) {
    const last = rows[rows.length - 1];
    if (item.kind === "tomo") {
      if (last !== undefined && last.kind === "tomo") {
        last.text += "\n\n" + item.text;
        continue;
      }
      rows.push({ kind: "tomo", text: item.text });
    } else if (item.kind === "tool") {
      if (last !== undefined && last.kind === "tool" && last.name === item.text) {
        last.count += 1;
        continue;
      }
      rows.push({ kind: "tool", name: item.text, count: 1 });
    } else if (item.kind === "user") {
      rows.push({ kind: "user", text: item.text, n: item.n });
    } else if (item.kind === "provider") {
      rows.push({ kind: "provider", text: item.text });
    } else if (item.kind === "error") {
      rows.push({ kind: "error", text: item.text });
    }
    // 未知の kind は無視 — 本体の語彙が増えても壊れない
  }
  return rows;
}

function statusLabel(status: string): string {
  if (status === "finished") {
    return "完了";
  }
  if (status === "cancelled") {
    return "中止";
  }
  return "進行中";
}

export function SessionPane({ sessionId }: SessionPaneProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let stale = false;
    setState({ kind: "loading" });
    // ダイジェスト（ヘッダ＋全文が無いときの本文）とスクロールバック（全文）を
    // 並行して取る。GetSessionScrollback は台帳照会を兼ね、忘却済み sid の
    // 全文を削除してから「無い」と返す（ADR-0003 Decision 2）ので、ここを通る
    // だけで忘却との整合が保たれる。
    Promise.all([GetSessionDigest(sessionId), GetSessionScrollback(sessionId)])
      .then(([detail, scrollback]) => {
        if (stale) {
          return;
        }
        // ユーザーの発話は view ストリームに乗らない（実測）ので、台帳ダイジェスト
        // の intent を n で引ける表にして全文へ差し込む（viewFold の userTurnsByN）。
        const userTurnsByN: Record<number, string> = {};
        for (const item of detail.items) {
          if (item.kind === "user") {
            userTurnsByN[item.n] = item.text;
          }
        }
        const transcript = scrollback.exists ? foldViewEvents(scrollback.events, userTurnsByN) : null;
        setState({ kind: "loaded", detail, transcript });
      })
      .catch((err: unknown) => {
        if (!stale) {
          setState({ kind: "error", message: errorMessage(err) });
        }
      });
    return () => {
      stale = true;
    };
  }, [sessionId]);

  function renderDigestRow(row: ViewRow, i: number) {
    switch (row.kind) {
      case "user":
        return (
          <div key={i} className="chat-message chat-message--user">
            <span className="chat-message-role">You</span>
            <p className="chat-message-text">{row.text}</p>
          </div>
        );
      case "tomo":
        return (
          <div key={i} className="chat-message chat-message--tomo">
            <span className="chat-message-role">Tomo</span>
            <Markdown text={row.text} />
          </div>
        );
      case "tool":
        return (
          <div key={i} className="session-digest-tool">
            ⚙ {row.name}
            {row.count > 1 ? ` ×${row.count}` : ""}
          </div>
        );
      case "provider":
        return (
          <div key={i} className="chat-message--system">
            Provider: {row.text}
          </div>
        );
      case "error":
        return (
          <div key={i} className="session-digest-error">
            エラー: {row.text}
          </div>
        );
    }
  }

  return (
    <div className="session-pane">
      {state.kind === "loading" && <p className="memory-status">読み込み中…</p>}
      {state.kind === "error" && (
        <p className="memory-status memory-status--error">読み込みに失敗: {state.message}</p>
      )}
      {state.kind === "loaded" && (
        <>
          <div className="session-pane-header">
            <h2>過去セッション</h2>
            <span className="session-pane-status">
              {new Date(state.detail.start_ts).toLocaleString()} ・{statusLabel(state.detail.status)}
            </span>
          </div>
          {state.transcript !== null ? (
            <>
              <p className="session-pane-note">
                スクロールバックからの全文（ADR-0003） — ライブと同じ表示。
                Tomoの応答はスクロールバックから、あなたの発話は台帳の記録（verbatim）から復元
              </p>
              <div className="session-digest-log">
                {state.transcript.map((message) => (
                  <MessageView key={message.id} message={message} />
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="session-pane-note">
                台帳の知覚用ダイジェストからの再構成 — 会話の全文ではない（ADR-0001）。
                ツール出力・整形は残っていない
              </p>
              <div className="session-digest-log">
                {foldItems(state.detail.items).map(renderDigestRow)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
