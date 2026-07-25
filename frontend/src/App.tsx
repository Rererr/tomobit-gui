import { useEffect, useRef, useState } from "react";
import "./App.css";
import { Sidebar } from "./components/Sidebar";
import { GrowthDisclosure } from "./components/GrowthDisclosure";
import { ChatPane } from "./components/ChatPane";
import { SettingsPane } from "./components/SettingsPane";
import { WorkspaceBar } from "./components/WorkspaceBar";
import { MemoryPane } from "./components/MemoryPane";
import { SessionPane } from "./components/SessionPane";
import { ClosingDialog } from "./components/ClosingDialog";
import { RunCommandProvider } from "./components/RunCommandProvider";
import {
  AbandonBoundary,
  EndTask,
  GetGUIConfig,
  GetSessions,
  GetSpriteSheet,
  GetTomoStatus,
  QuitNow,
  RunCommand,
  SaveGUIConfig,
  SendLine,
  SetWorkspace,
} from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime/runtime";
import type { main } from "../wailsjs/go/models";
import type { ChatMessage, DecidedEvent, PaneId, StreamChannel, TurnBlock } from "./types";
import { asDecidedEvent, asNumber, asString, isViewEvent } from "./types";
import { errorMessage } from "./errorMessage";
import { createRefreshCoalescer } from "./ledgerRefreshCoalescer";
import { parseBoundaryQuestion } from "./boundaryChoices";
import type { BoundaryQuestion } from "./boundaryChoices";

let nextMessageId = 0;

// task.finished/task.cancelled と chat:exit の実測ずれ（一桁〜数十ms）より
// 十分大きく、境界直後の一覧更新という体感（人には知覚できない背景更新の
// 遅延）を壊さない値。詳細は ledgerRefreshCoalescer.ts。
const LEDGER_REFRESH_DEBOUNCE_MS = 200;

function createMessageId(): string {
  nextMessageId += 1;
  return `msg-${nextMessageId}`;
}

interface OutChunkData {
  channel: StreamChannel;
  text: string;
}

interface ExitInfoData {
  error: string;
}

// 連続する text ブロックはひとつに結合する（本体は本文を細切れの text で流す）。
function appendTurnBlock(blocks: TurnBlock[], block: TurnBlock): TurnBlock[] {
  const last = blocks[blocks.length - 1];
  if (block.kind === "text" && last !== undefined && last.kind === "text") {
    return [...blocks.slice(0, -1), { kind: "text", text: last.text + block.text }];
  }
  return [...blocks, block];
}

function App() {
  const [activePane, setActivePane] = useState<PaneId>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [tomoStatus, setTomoStatus] = useState<main.TomoStatus | null>(null);
  // 姿の資産は動かないので起動時に一度だけ読む（本体 ADR-0048 Decision 2）。
  // 動く側（ステージ・気分）は refreshLedgerViews が境界ごとに配る。
  // 取れなければ null のまま — サイドバーのTomoセクションが黙って劣化する。
  const [sprite, setSprite] = useState<main.SpriteSheet | null>(null);
  // gui.json の唯一のコピー (ADR-0004 Consequences): 設定ペインと作業バーの
  // 2つの口が同じファイルを書くので、各画面が自前で読んだ古い写しから保存
  // すると片方の変更が消える。保存は必ずこの1つへマージしてから書く。
  // 保存の直後に別の保存が来ても最新を見られるよう ref も持つ（state は
  // 再描画用 — 二重管理は applyGUIConfig に閉じ込める）。
  const [guiConfig, setGuiConfig] = useState<main.GUIConfig | null>(null);
  const guiConfigRef = useRef<main.GUIConfig | null>(null);
  const [guiConfigError, setGuiConfigError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<main.SessionDigest[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  // 初回読み込み中だけ立てる（以後の再読み込みは既存の一覧を見せたまま裏で
  // 差し替える — 会話中の自動リフレッシュのたびに空表示へ点滅させない）。
  const [sessionsLoading, setSessionsLoading] = useState(true);
  // New chat が /exit を送ってから完了表示までの「区切り中」。イベント購読は
  // 一度きり(deps [])なので ref で最新値を読み、UI（空送信ボタンの活性化）は
  // state で再描画する — 二重管理は setBoundary に閉じ込める。
  const boundaryRef = useRef(false);
  const [boundaryActive, setBoundaryActive] = useState(false);
  // 「New chat が /exit を送った」ことの記憶。chat:exit の完了表示（区切った/
  // 終了した）の判別だけに使う。boundary（空送信の許可）とは寿命が違う —
  // boundary は task.finished（境界の器官が済んだ瞬間）で先に閉じるが、
  // その後に来る chat:exit はまだ「期待された終了」なので別々に持つ。
  const expectedExitRef = useRef(false);
  // 現在開いている Tomo のターン枠の id。turn.started で開き、turn.finished で閉じる。
  // text/tool/tool_result/error はこの id のターンへ追記する（購読は一度きりなので
  // ref で最新の開き枠を追う）。
  const openTurnIdRef = useRef<string | null>(null);
  // 窓の×が始めた締め (ADR-0005)。Go の beforeClose が /exit を送って閉窓を
  // 差し止め、app:closing でこちらへ知らせる。以後 await の note はチャット面
  // ではなくこのダイアログの問いになり、chat:exit で閉じる。イベント購読は
  // 一度きり(deps [])なので ref で最新を読み、UI は state で再描画する。
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const [closingQuestion, setClosingQuestion] = useState<BoundaryQuestion | null>(null);
  const [closingNotes, setClosingNotes] = useState<string[]>([]);
  // decided（本体 ADR-0040）は自分の task.started より先に届きうるので、
  // sid が一致するまで一時的に持つ（"最も直近の decided" を仮採用し、
  // sid 不一致なら黙って捨てる — 記帳とGUIの相関はsidだけが正）。
  const pendingDecidedRef = useRef<DecidedEvent | null>(null);
  // task.started で sid が一致した decided。同一タスク内で開く turn 全てに
  // 付与する（GUIは1プロセス1タスクなので次の decided が来るまで有効）。
  const activeDecidedRef = useRef<DecidedEvent | null>(null);
  // task.finished/task.cancelled と chat:exit は同一境界の別の観測なので、
  // 両方から呼ばれても refreshLedgerViews は1回に畳む（ledgerRefreshCoalescer）。
  const ledgerRefreshRef = useRef(
    createRefreshCoalescer(() => {
      void refreshLedgerViews();
    }, LEDGER_REFRESH_DEBOUNCE_MS),
  );

  function setBoundary(v: boolean) {
    boundaryRef.current = v;
    setBoundaryActive(v);
  }

  function setClosingMode(v: boolean) {
    closingRef.current = v;
    setClosing(v);
  }

  function applyGUIConfig(c: main.GUIConfig) {
    guiConfigRef.current = c;
    setGuiConfig(c);
  }

  async function loadGUIConfig() {
    try {
      applyGUIConfig(await GetGUIConfig());
      setGuiConfigError(null);
    } catch (err) {
      setGuiConfigError(`読み込みに失敗: ${errorMessage(err)}`);
    }
  }

  // 部分更新を今の設定へマージして保存する。呼び出し側は自分が触った項目だけを
  // 渡し、触っていない項目（他の画面が直前に変えたかもしれない値）は保たれる。
  async function saveGUIConfigPatch(patch: Partial<main.GUIConfig>) {
    const base = guiConfigRef.current;
    if (base === null) {
      throw new Error("設定がまだ読めていない");
    }
    const next = { ...base, ...patch } as main.GUIConfig;
    await SaveGUIConfig(next);
    applyGUIConfig(next);
  }

  // ヘッダのステージとセッション一覧は台帳のView。読み直すのは起動時と
  // プロセス終了時（= セッション境界 — 記帳・知覚が走りステージも一覧も
  // 動きうる瞬間）だけ: ポーリングはしない（低負荷、ADR-0001 Decision 3 と
  // 同じ「開くたびに読む」姿勢）。
  async function refreshLedgerViews() {
    // allSettled で独立に受ける: ヘッダ(サブプロセス呼び出し — 旧本体や
    // バイナリ不在で失敗しうる)の失敗は素の「Tomo」への局所的劣化に留め
    // (本体 ADR-0039 Decision 3)、セッション一覧のエラー欄に無関係な
    // 文言を混ぜない。診断は stderr 面へ流す。
    const [status, list] = await Promise.allSettled([GetTomoStatus(), GetSessions()]);
    if (status.status === "fulfilled") {
      setTomoStatus(status.value);
    } else {
      setTomoStatus(null);
      appendStderr(`ヘッダの取得に失敗: ${errorMessage(status.reason)}\n`);
    }
    if (list.status === "fulfilled") {
      setSessions(list.value.sessions);
      setSessionsError(null);
    } else {
      setSessionsError(errorMessage(list.reason));
    }
    setSessionsLoading(false);
  }

  // 姿の取得（本体 ADR-0048）。失敗は診断だけ流して黙る — 旧顔窓・未インストール
  // でも会話は続くべきで、姿が無いのは会話の障害ではない。
  async function loadSprite() {
    try {
      setSprite(await GetSpriteSheet());
    } catch (err) {
      appendStderr(`Tomoの姿の取得に失敗: ${errorMessage(err)}\n`);
    }
  }

  useEffect(() => {
    void refreshLedgerViews();
    void loadGUIConfig();
    void loadSprite();
    const offView = EventsOn("chat:view", (data: unknown) => {
      handleViewEvent(data);
    });
    // stderr（契約外の人間向け診断）は従来どおりチャンクで届く。
    const offOut = EventsOn("chat:out", (data: OutChunkData) => {
      if (data.channel === "stderr") {
        appendStderr(data.text);
      }
    });
    // 窓の×が締めを始めた (ADR-0005): 以後 await の note はダイアログの問いへ。
    const offClosing = EventsOn("app:closing", () => {
      setClosingMode(true);
      setClosingQuestion(null);
      setClosingNotes([]);
    });
    const offExit = EventsOn("chat:exit", (data: ExitInfoData) => {
      // 異常終了は区切り中でも隠さない: /exit の尾部（Feedback → 知覚）が
      // 失敗したのに「区切った」と言うのはエラーの握り潰しになる。
      const expected = expectedExitRef.current;
      expectedExitRef.current = false;
      setBoundary(false);
      ledgerRefreshRef.current.schedule();
      // 締めが終わった＝待つものは無い。×を押した人の意思どおり閉じる
      // （異常終了でも同じ: 待ち続ける相手がもう居ない）。
      if (closingRef.current) {
        void QuitNow();
        return;
      }
      if (data.error !== "") {
        appendSystem(`チャットのプロセスが異常終了した: ${data.error} — 次の送信で再開する`);
        return;
      }
      appendSystem(
        expected
          ? "区切った — 次の送信から新しいチャットが始まる"
          : "チャットのプロセスが終了した — 次の送信で再開する",
      );
    });
    return () => {
      offView();
      offOut();
      offClosing();
      offExit();
      ledgerRefreshRef.current.cancel();
    };
  }, []);

  function appendSystem(text: string) {
    setMessages((prev) => [...prev, { id: createMessageId(), kind: "system", text }]);
  }

  // stderr のチャンクを末尾の stderr エントリに継ぎ足す（連続チャンクは1つに結合）。
  function appendStderr(text: string) {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last !== undefined && last.kind === "stderr") {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...prev, { id: createMessageId(), kind: "stderr", text }];
    });
  }

  // 開いているターンへブロックを追記する。契約上ブロックは turn.started の後にしか
  // 来ないが、万一開き枠が無ければ落とさず新しい枠を開く（n/provider は不明）。
  function appendBlock(block: TurnBlock) {
    const openId = openTurnIdRef.current;
    if (openId === null) {
      const newId = createMessageId();
      openTurnIdRef.current = newId;
      setMessages((prev) => [...prev, { id: newId, kind: "turn", n: 0, provider: "", blocks: [block] }]);
      return;
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === openId && m.kind === "turn" ? { ...m, blocks: appendTurnBlock(m.blocks, block) } : m,
      ),
    );
  }

  // chat:view の NDJSON イベントを構造化メッセージへ落とす。未知の type は無視する
  // （本体 ADR-0032 の契約: 消費者は未知の type を無視せよ）。ready/init/provider/
  // task.started は消費してよい（表示しない）。
  function handleViewEvent(raw: unknown) {
    if (!isViewEvent(raw)) {
      return;
    }
    const ev = raw;
    switch (ev.type) {
      case "turn.started": {
        const id = createMessageId();
        openTurnIdRef.current = id;
        const n = asNumber(ev.n) ?? 0;
        const provider = asString(ev.provider) ?? "";
        const decided = activeDecidedRef.current ?? undefined;
        setMessages((prev) => [...prev, { id, kind: "turn", n, provider, blocks: [], decided }]);
        break;
      }
      case "task.started": {
        // decided は自分より先に届いているはずなので、sidが一致する分だけ
        // このタスクの監査行として採用する（本体 ADR-0040 Decision 1）。
        const sid = asString(ev.sid);
        activeDecidedRef.current =
          sid !== undefined && pendingDecidedRef.current?.sid === sid ? pendingDecidedRef.current : null;
        pendingDecidedRef.current = null;
        break;
      }
      case "decided": {
        const decided = asDecidedEvent(ev);
        if (decided !== undefined) {
          pendingDecidedRef.current = decided;
        }
        break;
      }
      case "text": {
        const text = asString(ev.text);
        if (text !== undefined && text !== "") {
          appendBlock({ kind: "text", text });
        }
        break;
      }
      case "tool": {
        const name = asString(ev.name);
        if (name !== undefined) {
          const detail = asString(ev.detail);
          appendBlock(detail !== undefined ? { kind: "tool", name, detail } : { kind: "tool", name });
        }
        break;
      }
      case "tool_result": {
        const text = asString(ev.text);
        if (text !== undefined) {
          appendBlock({ kind: "tool_result", text });
        }
        break;
      }
      case "error": {
        const message = asString(ev.message);
        if (message !== undefined && message !== "") {
          appendBlock({ kind: "error", message });
        }
        break;
      }
      case "turn.finished": {
        const id = openTurnIdRef.current;
        openTurnIdRef.current = null;
        const durationMs = asNumber(ev.duration_ms) ?? 0;
        const costUsd = asNumber(ev.cost_usd);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id && m.kind === "turn"
              ? { ...m, finished: costUsd !== undefined ? { durationMs, costUsd } : { durationMs } }
              : m,
          ),
        );
        break;
      }
      case "note": {
        const text = asString(ev.text);
        if (text === undefined || text === "") {
          break;
        }
        const awaiting = ev.await === true;
        // await の note は境界の Feedback 質問 = 入力欄で答える対象なので、空送信
        // （まだ言えない）を許す区切り状態に入れる。
        if (awaiting) {
          setBoundary(true);
        }
        // 窓を閉じる途中なら、同じ行がダイアログの問い（await）と経過の表示
        // （それ以外）になる (ADR-0005 Decision 2)。ログにも同じものを積む —
        // ダイアログは締めの間だけの器で、会話の記録はチャット面が持つ。
        if (closingRef.current) {
          if (awaiting) {
            setClosingQuestion(parseBoundaryQuestion(text));
          } else {
            setClosingNotes((prev) => [...prev, text.trim()]);
          }
        }
        setMessages((prev) => [...prev, { id: createMessageId(), kind: "note", text, await: awaiting }]);
        break;
      }
      case "task.finished":
      case "task.cancelled": {
        // 記帳・知覚が走りステージも一覧も動きうる瞬間。手で /new を打った場合は
        // これだけが台帳更新の合図になる（/exit 経由の refresh は chat:exit に残す）。
        // 境界の器官が済んだので空送信の許可も閉じる — /exit を経ないセッション
        // 境界（手打ちの /new）で「まだ言えない」ボタンが残留しないように。
        setBoundary(false);
        // 済んだタスクの decided を次のタスクへ持ち越さない（次に decided が
        // 来ない旧本体・do 経由の場合に古い監査行が誤って表示されるのを防ぐ）。
        activeDecidedRef.current = null;
        ledgerRefreshRef.current.schedule();
        break;
      }
      default:
        break;
    }
  }

  async function sendLine(line: string) {
    try {
      await SendLine(line);
    } catch (err) {
      appendSystem(`送信に失敗: ${errorMessage(err)}`);
    }
  }

  // 「New chat」= /exit (ADR-0001 追記: 反映境界 = セッション境界 = プロセス
  // 境界)。走行中のプロセスが無ければ区切る対象も無いので、何も起動せず
  // チャット面へ切り替えるだけ。ログは消さない: 区切りの尾部
  // (Feedback → 知覚 → Tomo)がこの直後にストリームで届くので、消すと会話の
  // 締めくくりごと見えなくなる。
  async function handleNewChat() {
    let started: boolean;
    try {
      started = await EndTask();
    } catch (err) {
      appendSystem(`区切りに失敗: ${errorMessage(err)}`);
      setActivePane("chat");
      return;
    }
    if (started) {
      expectedExitRef.current = true;
      setBoundary(true);
      // 区切り中も入力は生かす: 直後に届くTomoの締めの質問（Feedback）への答えは
      // この入力欄から送る。代わりに「新しい話はまだ届かない」ことを言葉で伝える。
      // この文に完了表示の「区切った」を含めない: 完了を文字列で探す目（人も
      // スクリプトも）が宣言に誤発火する — E2E 実測で踏んだ罠。
      appendSystem("ここまでを区切って次のタスクへ (/exit) — 締めの質問にはそのまま答えられる。新しい話は締めが終わってから");
    }
    setActivePane("chat");
  }

  function handleSend(draft: string) {
    // 改行は潰さず保持する: 本体 cooked mode の末尾 `\` 継続でエンコードされ
    // 1ターンに繋ぎ直される（ADR-0032 Decision 2）。エンコードは Go 側の SendLine。
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (boundaryRef.current) {
        // 締めの質問への空回答（=まだ言えない）は吹き出しを作らないが、無痕跡だと
        // 読み返しで「Tomoの自問自答」に見える — 軽い注記だけ残す。
        appendSystem("（まだ言えない — 空のまま回答）");
      }
      void sendLine("");
      return;
    }
    setMessages((prev) => [...prev, { id: createMessageId(), kind: "user", text: trimmed }]);
    void sendLine(trimmed);
  }

  // 作業バーの変更は即保存する（設定ペインのような保存ボタンは置かない —
  // フォルダを選ぶ操作そのものが確定の意思表示）。保存と同時に走行中のチャットへ
  // 宣言が飛ぶ (ADR-0004 改訂 Decision 3)。効き始めの言葉はここでは足さない:
  // 受け取ったかどうかは本体が答え、その返事は view ストリームでこの同じログに
  // 出る（タスクの途中なら「/new で区切ってから」と本体が言う）。
  function handleWorkspaceChange(workingDir: string, readDirs: string[]) {
    void SetWorkspace(workingDir, readDirs)
      .then((update) => {
        applyGUIConfig(update.config);
        if (update.pending) {
          // 走行中のタスクには届いていない。バーの見た目だけ変わって Tomo は
          // 前の場所のまま、という食い違いを黙って作らない。
          appendSystem("働く場所を保存した — 今のタスクには効かない。New chat で区切った後から");
        }
      })
      .catch((err: unknown) => {
        appendSystem(`働く場所の保存に失敗: ${errorMessage(err)}`);
      });
  }

  // 締めダイアログのボタン1つ = 端末で打つ1行 (ADR-0005 Decision 2)。空文字は
  // 本体の「無信号」経路（Enter=まだ言えない/スキップ）そのもの。答えた瞬間に
  // 問いを畳んで、次の器官の質問が来るまで待ちの表示へ戻す。
  function handleClosingAnswer(send: string) {
    setClosingQuestion(null);
    void sendLine(send);
  }

  // 「待たずに閉じる」: 猶予を捨てて即座に回収する（Go 側 AbandonBoundary）。
  function handleAbandonBoundary() {
    setClosingMode(false);
    void AbandonBoundary();
  }

  // サイドバーの畳み状態は gui.json の表示ノブ (ADR-0001 Decision 4 / ADR-0006)。
  // 保存の失敗は黙って飲む: 畳んだ形が次回に残らないだけで、今の画面は既に
  // 畳まれている（details の開閉はブラウザが持つ）— 会話面へ出す値打ちは無い。
  function saveSidebarFold(patch: Partial<main.GUIConfig>) {
    void saveGUIConfigPatch(patch).catch(() => {});
  }

  function handleSelectSession(sessionID: string) {
    setSelectedSession(sessionID);
    setActivePane("session");
  }

  // 成長開示（本体 ADR-0046）はヘッダのステージから開く。growth が無い
  // （旧本体・台帳なし・最上位あいぼうは本体がフィールドごと省く）ときは
  // 開示UI自体を出さない — 劣化は沈黙（decided と同じ扱い）。
  const growth = tomoStatus !== null && tomoStatus.exists ? (tomoStatus.growth ?? null) : null;
  const headerLine = (
    <>
      <span title="成長ステージ — 台帳からの導出View（顔窓と同じ式）">
        {tomoStatus !== null && tomoStatus.exists ? `Tomo · ${tomoStatus.stage_name}` : "Tomo"}
        {tomoStatus?.mood?.marker ? ` ${tomoStatus.mood.marker}` : ""}
      </span>
      {tomoStatus?.speak ? (
        <span className="main-header-speak" title={tomoStatus.speak}>
          「{tomoStatus.speak}」
        </span>
      ) : null}
    </>
  );

  return (
    // 実行ボタン (ADR-0007) の配線。チャットと過去セッションは同じ MessageView →
    // Markdown を通るので、両方を含む一番外側で1度だけ配る。設定がまだ読めて
    // いない間 (guiConfig === null) は無効 — 読めていないことを ON 側へ倒さない。
    <RunCommandProvider
      value={{
        enabled: guiConfig?.run_command === true,
        workingDir: guiConfig?.working_dir ?? "",
        run: RunCommand,
      }}
    >
    <div id="app">
      <Sidebar
        activePane={activePane}
        sessions={sessions}
        sessionsError={sessionsError}
        sessionsLoading={sessionsLoading}
        selectedSession={selectedSession}
        tomoStatus={tomoStatus}
        sprite={sprite}
        tomoCollapsed={guiConfig?.sidebar_tomo_collapsed ?? false}
        usageCollapsed={guiConfig?.sidebar_usage_collapsed ?? false}
        onToggleTomo={(collapsed) => saveSidebarFold({ sidebar_tomo_collapsed: collapsed })}
        onToggleUsage={(collapsed) => saveSidebarFold({ sidebar_usage_collapsed: collapsed })}
        onNewChat={handleNewChat}
        onSelectPane={setActivePane}
        onSelectSession={handleSelectSession}
      />
      <main className="main-pane">
        {/* Tomo名ヘッダ (ADR-0001 Decision 5): 台帳から導出したテキストView。
            台帳がまだ無ければステージは名乗らない。growth があれば
            details/summary（本体 ADR-0040 Decision 2 の作法: 既定は畳む）で
            次の段の内訳を開ける */}
        <header className="main-header">
          {growth !== null ? (
            <details className="main-header-growth">
              <summary title="成長ステージ — 開くと次の段に何が足りないかが見える">
                <span className="main-header-line">{headerLine}</span>
              </summary>
              <GrowthDisclosure growth={growth} />
            </details>
          ) : (
            <div className="main-header-line">{headerLine}</div>
          )}
        </header>
        {/* チャットと設定はアンマウントせず隠すだけ: 入力途中の下書き・未保存の
            喋り方編集がペイン切替で消えるのを防ぐ（実機レビューで確認された
            データロス）。メモリと過去セッションは意図的に毎回マウントし直す —
            開くたびに台帳の最新を読み直す方が、黙って古いViewを見せるより正しい */}
        <div style={{ display: activePane === "chat" ? "contents" : "none" }}>
          <ChatPane
            messages={messages}
            onSend={handleSend}
            allowEmptySend={boundaryActive}
            workspace={
              <WorkspaceBar
                workingDir={guiConfig === null ? null : (guiConfig.working_dir ?? "")}
                readDirs={guiConfig?.read_dirs ?? []}
                onChange={handleWorkspaceChange}
                onError={appendSystem}
              />
            }
          />
        </div>
        <div style={{ display: activePane === "settings" ? "contents" : "none" }}>
          <SettingsPane
            config={guiConfig}
            loadError={guiConfigError}
            onReload={() => void loadGUIConfig()}
            onSave={saveGUIConfigPatch}
          />
        </div>
        {activePane === "memory" && <MemoryPane tomoStatus={tomoStatus} />}
        {activePane === "session" && selectedSession !== null && (
          <SessionPane sessionId={selectedSession} />
        )}
      </main>
      {closing && (
        <ClosingDialog
          question={closingQuestion}
          notes={closingNotes}
          onAnswer={handleClosingAnswer}
          onAbandon={handleAbandonBoundary}
        />
      )}
    </div>
    </RunCommandProvider>
  );
}

export default App;
