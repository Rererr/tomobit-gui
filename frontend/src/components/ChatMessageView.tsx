import { memo } from "react";
import type { ChatMessage, DecidedEvent, TurnBlock, TurnMessage } from "../types";
import type { FoldedBlock, WorkBlock } from "../turnFold";
import { foldWorkBlocks, workSummaryLabel } from "../turnFold";
import { REACTION_CLEAR, reactionGlyph, reactionLabel, reactionState } from "../reaction";
import { splitStreamingMarkdown } from "../streamingMarkdown";
import { useReactionPort } from "./ReactionProvider";
import { Markdown } from "./Markdown";

// ChatPane から切り出した読み取り専用の描画部（ADR-0003 Decision 1: 過去表示は
// ライブと同じ構造化描画を再利用する）。ライブの ChatPane も過去の SessionPane も
// この同じ MessageView で 1 メッセージを描く — 全文表示がライブと1ピクセルも
// 食い違わないための単一の描画源。入力・スクロール追従など対話の状態は持たない。
//
// 名前行を省く規則は speakerName.ts にある（node --test から読める形にするため —
// このファイルは React と JSX を import するので、テストからは読めない）。

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

// 流れている最中の本文。確定した段落と伸びている末尾に切り分けて、別々の
// Markdown へ渡す (streamingMarkdown.ts / 2026-07-26 の応答停止への修正)。
// 確定ぶんは text が変わらないので memo が再パースを飛ばし、毎フレーム解き直す
// のは末尾だけになる。切らずに全文を渡していた頃は、1回のパース費用が累積量に
// 比例して伸び、長いターンでフレームが返らなくなっていた。
function StreamingText({ text }: { text: string }) {
  const segments = splitStreamingMarkdown(text);
  return (
    <>
      {segments.map((segment, i) => (
        <Markdown key={i} text={segment} />
      ))}
    </>
  );
}

// TurnBlock だけを受ける（FoldedBlock ではない）: work は TurnCard 側で
// 末尾に1つだけ抜き出して TurnMeta が描くので、ここに渡る配列に "work" は
// 型としても現れない——分岐が要らないことを型が保証する。
function renderBlock(block: TurnBlock, key: number, streaming: boolean) {
  switch (block.kind) {
    case "text":
      // 終わったターンは全文を1回で解き直す: 段落ごとの独立パースは緩いリスト
      // などで全文パースと解釈が食い違いうるので、残る表示は従来のまま揃える。
      return (
        <div key={key} className="chat-turn-text">
          {streaming ? <StreamingText text={block.text} /> : <Markdown text={block.text} />}
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

/**
 * turnFold.ts の不変条件（work はターンにつき高々1つ、必ず末尾）を型にも
 * 伝える分離。folded を直接 renderBlock へ渡さず、ここで body（TurnBlock[]）と
 * work（あれば）へ分けるので、renderBlock は "work" ケースを持たずに済む——
 * find/filter の型述語で絞るので、位置（末尾）を信じ切らずに済む。
 */
function splitTrailingWork(folded: FoldedBlock[]): { body: TurnBlock[]; work: WorkBlock | undefined } {
  const work = folded.find((b): b is WorkBlock => b.kind === "work");
  const body = folded.filter((b): b is TurnBlock => b.kind !== "work");
  return { body, work };
}

// ターンのメタ1行（本体 ADR-0040 の「なぜこのProviderか」・所要時間・コスト・
// 作業件数を1本へ合流させる、GUI ADR-0014 Decision 3）。旧 chat-turn-provider-chip
// （常時チップ）・chat-turn-decided（常時トグル）・chat-turn-footer（帳簿だけの
// 行）が答えの周りにそれぞれ出ていたのをやめ、答えの隣は1行だけにする。
//
// 呼ばれるのは終わったターンだけ（TurnCard 参照）— 走行中は所要時間もコストも
// まだ無く、provider は走行中の帯 (ADR-0008) が既に言っている。
function TurnMeta({
  work,
  provider,
  finished,
  decided,
}: {
  work: WorkBlock | undefined;
  provider: string;
  finished: NonNullable<TurnMessage["finished"]>;
  decided: DecidedEvent | undefined;
}) {
  const parts: string[] = [];
  if (work !== undefined) {
    parts.push(workSummaryLabel(work));
  }
  // provider 名は畳んだ行に残す — 誰が答えたかは本文の隣にあってよい情報だが、
  // 常時チップで持ち上げるほどではない。
  if (provider !== "") {
    parts.push(provider);
  }
  parts.push(formatDuration(finished.durationMs));
  if (finished.costUsd !== undefined) {
    parts.push(`$${finished.costUsd.toFixed(4)}`);
  }
  const label = parts.join(" · ");

  // 開ける中身（作業ログ・なぜこのProviderか）が無ければ details にしない。
  // 三角は「開くと何か出る」という約束で、約束できない時にまで付けると
  // 機能しない矢印だけが残る（作業0件・decidedも無い旧本体経由などで起きる）。
  // --bare は三角のぶんの場所だけ空ける印: 開けるかどうかで行の左端が動くと、
  // 本文は揃っているのにメタ行だけがターンごとにガタつく（App.css 参照）。
  if (work === undefined && decided === undefined) {
    return <div className="chat-turn-meta chat-turn-meta--bare">{label}</div>;
  }

  return (
    <details className="chat-turn-meta">
      <summary>{label}</summary>
      <div className="chat-turn-meta-blocks">
        {work !== undefined && work.blocks.map((block, i) => renderBlock(block, i, false))}
        {/* decided（本体 ADR-0040）を持つターンだけ節を持つ。無いタスク
            （旧本体・do 経由）では節自体を出さない — 劣化は沈黙。 */}
        {decided !== undefined && (
          <details className="chat-turn-decided">
            <summary>なぜこのProviderか</summary>
            <DecidedDisclosure decided={decided} />
          </details>
        )}
      </div>
    </details>
  );
}

/**
 * 返答の隣に置く反応 (ADR-0014 Decision 4)。Slack の作法どおり、**ホバーで現れ、
 * 置いてあれば常に見える**。
 *
 * 口を出すのは「いま開いているタスクの・終わった・sub を持たないターン」だけで、
 * それ以外（過去セッション、区切りの向こう側、走行中、分割の子）では**置かれた
 * 印だけ**を出す —— 押せる時と押せない時のあるボタンは、押せない時に理由を
 * 訊かれる。置ける先は port が持っている（GUI は誰に置けるかを自分で決めない）。
 */
function ReactionRow({ message, latestTurn }: { message: TurnMessage; latestTurn: boolean }) {
  const { vocabulary, placeable, react } = useReactionPort();
  const canPlace =
    vocabulary !== null &&
    message.sub === undefined &&
    message.finished !== undefined &&
    placeable.has(message.id);
  // 会話の最後のターンだけは、ホバー無しでも口を見せる（ADR-0014 Decision 4）。
  // 「最後」の判定は isLatestTurn（reaction.ts）に集約してあり、ここは
  // その結果を1クラスへ落とすだけ——DOM の :last-child は note 等が挟まると
  // 崩れるので使わない（isLatestTurn の Why not 参照）。
  const rowClassName = latestTurn ? "chat-turn-reactions chat-turn-reactions--latest" : "chat-turn-reactions";

  if (!canPlace) {
    if (message.reaction === undefined) {
      return null;
    }
    const label = reactionLabel(message.reaction, vocabulary);
    return (
      <div className={rowClassName}>
        {/* 絵文字そのものが情報なので、読み上げには本体のラベル文を渡す */}
        <span className="chat-reaction-placed" role="img" aria-label={label} title={label}>
          {reactionGlyph(message.reaction, vocabulary)}
        </span>
      </div>
    );
  }

  return (
    <div className={rowClassName}>
      {vocabulary.map((v) => {
        const state = reactionState(message, v.word);
        const waiting = state === "placing" || state === "clearing";
        const active = state === "placed" || state === "placing";
        // 「送った」と「記帳された」を同じ見え方にしない。半透明は色の話なので、
        // 待っていることは読み上げにも届く文言で言う。
        const label = waiting
          ? `${reactionLabel(v.word, vocabulary)}（送信待ち）`
          : reactionLabel(v.word, vocabulary);
        return (
          <button
            key={v.word}
            type="button"
            className={`chat-reaction-btn${active ? " chat-reaction-btn--active" : ""}${
              waiting ? " chat-reaction-btn--waiting" : ""
            }`}
            aria-pressed={active}
            aria-label={label}
            title={label}
            // もう一度同じ記号を押したら取り消す（トグル）。
            onClick={() => react(message.n, active ? REACTION_CLEAR : v.word)}
          >
            {reactionGlyph(v.word, vocabulary)}
          </button>
        );
      })}
    </div>
  );
}

function TurnCard({
  message,
  sameSpeaker,
  latestTurn,
}: {
  message: TurnMessage;
  sameSpeaker: boolean;
  latestTurn: boolean;
}) {
  // 走行中はそのまま、終わったら作業ログを畳んで答えを前に出す（turnFold.ts）。
  // 畳むのは見た目だけで、ブロックは1つも捨てない。最初のブロックが来るまでの
  // 空白に置いていた考え中のドットは、会話の末尾の帯 (ADR-0008) に一本化した
  // — 枠の中と末尾で2つ同時に跳ねるより、動いていることを言う場所は1つの方が
  // 読める。過去セッションの再生でも同じ: 途中で切れたターンが、開くたびに
  // 「まだ考えている」ふりをすることが無くなる。
  const folded = foldWorkBlocks(message.blocks, message.finished !== undefined);
  const { body, work } = splitTrailingWork(folded);
  return (
    <div className={message.sub !== undefined ? "chat-message chat-message--subtask" : "chat-message"}>
      <div className="chat-turn-header">
        {/* 連続する Tomo のターンでは名前行を目からは省く。読み上げ用のラベルは
            消さず sr-only へ切り替える（ADR-0014 Decision 1） */}
        <span className={sameSpeaker ? "sr-only" : "chat-message-role"}>Tomo</span>
        {/* 分割の子は自分が何本目かを名乗る。並走すると枠が同時に複数開き、
            並び順だけでは対応が読めない（本体 ADR-0032 の sub / sub_total）。 */}
        {message.sub !== undefined && (
          <span className="chat-turn-subtask-chip">
            サブタスク {message.sub}
            {message.subTotal !== undefined && `/${message.subTotal}`}
          </span>
        )}
      </div>
      <div className="chat-turn-blocks">
        {body.map((block, i) => renderBlock(block, i, message.finished === undefined))}
      </div>
      {message.finished !== undefined && (
        <TurnMeta work={work} provider={message.provider} finished={message.finished} decided={message.decided} />
      )}
      {/* 反応はメタ1行の下（答えの一番近く）。走行中のターンには出ない —
          まだ「その返答」が完成していない (ADR-0014 Decision 4)。 */}
      {message.finished !== undefined && <ReactionRow message={message} latestTurn={latestTurn} />}
    </div>
  );
}

/**
 * 1 つの ChatMessage を描く。ライブ・過去の両方がこの単一の描画源を通す。
 *
 * memo で包むのは速さのためではなく、固まらないため (2026-07-26 の応答停止)。
 * ストリームが動かすのは常に最後のターン1つだけなのに、包まないと到着のたびに
 * 確定済みの全メッセージが再描画され、その全てで foldWorkBlocks が再計算される。
 * 追記は appendBlocksTo が対象ターンだけ新しい参照に差し替えるので、既定の
 * 浅い比較で「動いていないものは描き直さない」が成立する。sameSpeaker /
 * latestTurn はどちらも boolean 1つなので、この shallow compare を壊さない
 * （speakerName.ts の sameSpeakerAsPrevious、reaction.ts の isLatestTurn 参照）。
 */
export const MessageView = memo(function MessageView({
  message,
  sameSpeaker,
  latestTurn = false,
}: {
  message: ChatMessage;
  /** 直前のメッセージと話者が同じか（ADR-0014 Decision 1）。note/system/stderr
   *  では使わない——名前欄そのものを持たない声だから。 */
  sameSpeaker: boolean;
  /** 会話の最後のターンか（ADR-0014 Decision 4、isLatestTurn 参照）。真なら
   *  反応の口をホバー無しでも見せる。既定 false は「過去の再生 (SessionPane)
   *  は渡さない」を配線ではなく既定値で成立させる——過去は読み取り専用で、
   *  口が出ないので意味が無い。 */
  latestTurn?: boolean;
}) {
  switch (message.kind) {
    case "user":
      return (
        <div className="chat-message">
          {/* 誰の発言かは名前行が言う（ADR-0014 Decision 1）。連続する自分の
              発言では目からは省き、読み上げ用にだけ sr-only で残す——目には
              冗長でも耳には境界が要る。chat-log は role="log" で新着を読み
              上げる面（ChatPane 参照）なので、話者が消えると自分の発言と
              Tomoの発言が地続きに聞こえる。 */}
          <span className={sameSpeaker ? "sr-only" : "chat-message-role"}>You</span>
          <p className="chat-message-text">{message.text}</p>
        </div>
      );
    case "turn":
      return <TurnCard message={message} sameSpeaker={sameSpeaker} latestTurn={latestTurn} />;
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
});
