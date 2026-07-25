import type { ChatMessage, DecidedEvent, TurnMessage } from "../types";
import type { FoldedBlock, WorkBlock } from "../turnFold";
import { foldWorkBlocks, workSummaryLabel } from "../turnFold";
import { Markdown } from "./Markdown";

// ChatPane から切り出した読み取り専用の描画部（ADR-0003 Decision 1: 過去表示は
// ライブと同じ構造化描画を再利用する）。ライブの ChatPane も過去の SessionPane も
// この同じ MessageView で 1 メッセージを描く — 全文表示がライブと1ピクセルも
// 食い違わないための単一の描画源。入力・スクロール追従など対話の状態は持たない。

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

/** wins:-1 はゲート未通過(トーナメント不参加)を表す（本体 ADR-0040 Decision 1）。 */
function formatWins(wins: number): string {
  return wins === -1 ? "不参加" : `${wins}`;
}

// 「なぜこのProviderか」の監査行（本体 ADR-0040 Decision 1 の candidates）。
// 既定は畳む(Decision 2) — この表は詳細を開いた時にしか描画しない。
function DecidedDisclosure({ decided }: { decided: DecidedEvent }) {
  return (
    <div className="chat-decided-disclosure">
      {decided.fallback && (
        <p className="chat-decided-fallback-note">
          どの候補も基準に届かなかったため、その中で最も見込みのある候補を選んだ
        </p>
      )}
      <table className="chat-decided-table">
        <caption className="sr-only">判断の監査行: 候補ごとの分位点・ゲート判定・勝ち数</caption>
        <colgroup>
          <col className="chat-decided-col-provider" />
          <col className="chat-decided-col-scope" />
          <col className="chat-decided-col-quantile" />
          <col className="chat-decided-col-gate" />
          <col className="chat-decided-col-wins" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="chat-decided-col-provider">
              Provider
            </th>
            <th scope="col">スコープ</th>
            <th scope="col" className="chat-decided-col-quantile">
              分位点
            </th>
            <th scope="col" className="chat-decided-col-gate">
              ゲート
            </th>
            <th scope="col" className="chat-decided-col-wins">
              勝ち数
            </th>
          </tr>
        </thead>
        <tbody>
          {decided.candidates.map((candidate, i) => {
            const isChosen = candidate.provider === decided.provider;
            const rowClassName = isChosen
              ? decided.fallback
                ? "chat-decided-row chat-decided-row--chosen-fallback"
                : "chat-decided-row chat-decided-row--chosen"
              : "chat-decided-row";
            return (
              <tr key={i} className={rowClassName}>
                <td className="chat-decided-col-provider">
                  {candidate.provider}
                  {isChosen && "（採用）"}
                </td>
                <td className="chat-decided-cell-scope" title={candidate.scope}>
                  {candidate.scope}
                </td>
                <td className="chat-decided-col-quantile">{candidate.quantile.toFixed(2)}</td>
                <td className="chat-decided-col-gate">{candidate.passed ? "✓" : "✗"}</td>
                <td className="chat-decided-col-wins">{formatWins(candidate.wins)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// 終わったターンの作業ログ（turnFold.ts が畳んだ連なり）。中身は 1 つも
// 捨てていないので、開けば元の順序のまま全部出る — chat-turn-tool-result と
// 同じネイティブ details/summary で、開閉とキーボード操作はブラウザに委ねる。
function WorkFold({ work }: { work: WorkBlock }) {
  return (
    <details className="chat-turn-work">
      <summary>{workSummaryLabel(work)}</summary>
      <div className="chat-turn-work-blocks">{work.blocks.map((block, i) => renderBlock(block, i))}</div>
    </details>
  );
}

function renderBlock(block: FoldedBlock, key: number) {
  switch (block.kind) {
    case "work":
      return <WorkFold key={key} work={block} />;
    case "text":
      return (
        <div key={key} className="chat-turn-text">
          <Markdown text={block.text} />
        </div>
      );
    case "tool":
      return (
        <div key={key} className="chat-turn-tool">
          {block.detail !== undefined ? `${block.name} · ${block.detail}` : block.name}
        </div>
      );
    case "tool_result":
      // 既定折り畳み: 本体は無加工・上限なしで流す（表示予算は消費者=GUIの責務、
      // 本体 ADR-0032）。開いた時だけ全文をスクロール領域に見せる。
      return (
        <details key={key} className="chat-turn-tool-result">
          <summary>ツール出力</summary>
          <pre className="chat-turn-tool-result-body">{block.text}</pre>
        </details>
      );
    case "error":
      return (
        <div key={key} className="chat-turn-error">
          {block.message}
        </div>
      );
  }
}

// decided（本体 ADR-0040）を持つターンだけ開示トグルを持つ。無いタスク
// （旧本体・do 経由）ではトグル自体を出さない — 劣化は沈黙。トグルは
// chat-turn-tool-result と同じネイティブ details/summary（開閉状態・
// キーボード操作をブラウザに委譲する）。ヘッダのflex行には入れず兄弟の
// ブロックとして置く — flex行の中で開くと他の子(role/chip)がテーブルの
// 高さ分だけ縦中央に押し流されるため。
function TurnCard({ message }: { message: TurnMessage }) {
  return (
    <div className="chat-message chat-message--tomo">
      <div className="chat-turn-header">
        <span className="chat-message-role">Tomo</span>
        {message.provider !== "" && <span className="chat-turn-provider-chip">{message.provider}</span>}
      </div>
      {message.decided !== undefined && (
        <details className="chat-turn-decided">
          <summary>なぜこのProviderか</summary>
          <DecidedDisclosure decided={message.decided} />
        </details>
      )}
      {message.blocks.length === 0 && message.finished === undefined ? (
        // turn.started は届いたが最初のブロックがまだ無い間の空白。無反応に
        // 見えないよう、考え中であることだけ示す（内容は先取りしない）。
        <div className="chat-turn-thinking" aria-label="考え中">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <div className="chat-turn-blocks">
          {/* 走行中はそのまま、終わったら作業ログを畳んで答えを前に出す
              （turnFold.ts）。畳むのは見た目だけで、ブロックは1つも捨てない。 */}
          {foldWorkBlocks(message.blocks, message.finished !== undefined).map((block, i) =>
            renderBlock(block, i),
          )}
        </div>
      )}
      {message.finished !== undefined && (
        <div className="chat-turn-footer">
          {formatDuration(message.finished.durationMs)}
          {message.finished.costUsd !== undefined && ` · $${message.finished.costUsd.toFixed(4)}`}
        </div>
      )}
    </div>
  );
}

/** 1 つの ChatMessage を描く。ライブ・過去の両方がこの単一の描画源を通す。 */
export function MessageView({ message }: { message: ChatMessage }) {
  switch (message.kind) {
    case "user":
      return (
        <div className="chat-message chat-message--user">
          {/* 誰の発言かは右寄せと吹き出しの色で分かるので、ラベルは目には出さない。
              ただし消しはしない —— 右寄せも背景色も、読み上げには何も伝えない。
              chat-log は role="log" で新着を読み上げる面（ChatPane 参照）なので、
              話者が消えると自分の発言とTomoの発言が地続きに聞こえる。
              sr-only は判断の監査行の table caption と同じ扱い。 */}
          <span className="sr-only">You</span>
          <p className="chat-message-text">{message.text}</p>
        </div>
      );
    case "turn":
      return <TurnCard message={message} />;
    case "note":
      return (
        <div className={message.await ? "chat-message--note chat-message--note-await" : "chat-message--note"}>
          {message.text}
        </div>
      );
    case "system":
      return <div className="chat-message--system">{message.text}</div>;
    case "stderr":
      return <div className="chat-message--stderr">{message.text}</div>;
  }
}
