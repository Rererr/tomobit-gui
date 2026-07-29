import { useEffect, useRef, useState } from "react";
import "./App.css";
import { Sidebar } from "./components/Sidebar";
import { GrowthDisclosure } from "./components/GrowthDisclosure";
import { ChatPaneHost } from "./components/ChatPaneHost";
import { AppClosingSheet } from "./components/AppClosingSheet";
import { SettingsPane } from "./components/SettingsPane";
import { MemoryPane } from "./components/MemoryPane";
import { SessionPane } from "./components/SessionPane";
import {
  AddPane,
  ClosePane,
  GetGUIConfig,
  GetPanes,
  GetSessions,
  GetSpriteSheet,
  GetTomoStatus,
  SaveGUIConfig,
  SetWorkspace,
} from "../wailsjs/go/main/App";
import type { main } from "../wailsjs/go/models";
import type { PaneId } from "./types";
import { errorMessage } from "./errorMessage";
import { createRefreshCoalescer } from "./ledgerRefreshCoalescer";
import { paneGridClass, sharedPlaces } from "./panes";
import { closingSections } from "./closingSheet";
import type { PaneClosing } from "./closingSheet";

// task.finished/task.cancelled と chat:exit の実測ずれ（一桁〜数十ms）より
// 十分大きく、境界直後の一覧更新という体感（人には知覚できない背景更新の
// 遅延）を壊さない値。詳細は ledgerRefreshCoalescer.ts。
const LEDGER_REFRESH_DEBOUNCE_MS = 200;

function App() {
  const [activePane, setActivePane] = useState<PaneId>("chat");
  // 会話面の窓 (ADR-0009)。Go が正本を持ち、ここはその写し — 窓の生死は
  // セッションの生死なので、追加も削除も Go を通す。
  const [panes, setPanes] = useState<main.PaneConfig[]>([]);
  // 締めが走り始めた窓。chat:exit を待ってから実際に畳む — 器官が答えを
  // 聞き終える前に画面ごと消すと、ADR-0005 が直した「答えられない締め」に戻る。
  const closingPanesRef = useRef<Set<string>>(new Set());
  // アプリの×の締めは App 直下の1枚に集まる (ADR-0012 Decision 1)。窓は自分の
  // 断面をここへ渡すだけで、縦の並びと器（フォーカス・「待たずに閉じる」）は
  // アプリの層が持つ — アプリ全体の行為なのだから、窓の中には収まらない。
  const [closingByPane, setClosingByPane] = useState<Map<string, PaneClosing>>(() => new Map());
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
  // task.finished/task.cancelled と chat:exit は同一境界の別の観測なので、
  // 両方から呼ばれても refreshLedgerViews は1回に畳む（ledgerRefreshCoalescer）。
  const ledgerRefreshRef = useRef(
    createRefreshCoalescer(() => {
      void refreshLedgerViews();
    }, LEDGER_REFRESH_DEBOUNCE_MS),
  );
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
  // ヘッダ・姿の取得失敗はどの窓の出来事でもない (Tomo 一匹に属する導出View)。
  // 会話面へ流し込む相手が一意でなくなったので、人間向け面へ出す。
  function appendDiagnostic(text: string) {
    console.error(text.trimEnd());
  }

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
      appendDiagnostic(`ヘッダの取得に失敗: ${errorMessage(status.reason)}\n`);
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
      appendDiagnostic(`Tomoの姿の取得に失敗: ${errorMessage(err)}\n`);
    }
  }

  useEffect(() => {
    // 起動時に一度だけ読むもの (ADR-0048 Decision 2 / ADR-0001 Decision 3)。
    // チャットのストリーム購読は窓ごとに useChatSession が張る。
    void refreshLedgerViews();
    void loadGUIConfig();
    void loadSprite();
    void loadPanes();
    return () => {
      ledgerRefreshRef.current.cancel();
    };
  }, []);

  async function loadPanes() {
    try {
      setPanes(await GetPanes());
    } catch (err) {
      // 窓が1つも読めないのは会話面が消えるのと同じなので、黙らない。
      setGuiConfigError(`窓の構成を読めなかった: ${errorMessage(err)}`);
    }
  }

  async function handleAddPane() {
    try {
      setPanes(await AddPane());
      setActivePane("chat");
    } catch (err) {
      setGuiConfigError(errorMessage(err));
    }
  }

  // 窓を閉じる = その窓のセッションを区切る (ADR-0009 Decision 4)。Go が /exit を
  // 送って締めが走り始めたら、畳むのは chat:exit が届いてから。
  async function handleClosePane(pane: string) {
    let started: boolean;
    try {
      started = await ClosePane(pane);
    } catch (err) {
      setGuiConfigError(errorMessage(err));
      return;
    }
    if (started) {
      closingPanesRef.current.add(pane);
      return;
    }
    void loadPanes();
  }

  // 走っていた窓の締めが終わった。ここで初めて画面から畳む。
  function handlePaneExit(pane: string) {
    if (!closingPanesRef.current.delete(pane)) {
      return;
    }
    void loadPanes();
  }

  // 窓が渡してくる締めの断面を預かる。締めていない窓も起動のたびに null を言う
  // ので、消すものが無ければ前の Map をそのまま返す — 新しい Map を作ると、窓の
  // 数だけ App が描き直される（窓は Tomo 一匹ぶんの View も抱えている）。
  function handleClosingState(pane: string, closing: PaneClosing | null) {
    setClosingByPane((prev) => {
      if (closing === null) {
        if (!prev.has(pane)) {
          return prev;
        }
        const next = new Map(prev);
        next.delete(pane);
        return next;
      }
      return new Map(prev).set(pane, closing);
    });
  }

  // 働く場所の保存は窓ごと (ADR-0009 Decision 3)。返す文字列はその窓の会話面へ
  // 出す一言で、null は「言うことは無い」。
  async function handleWorkspaceChange(
    pane: string,
    workingDir: string,
    readDirs: string[],
  ): Promise<string | null> {
    try {
      const update = await SetWorkspace(pane, workingDir, readDirs);
      applyGUIConfig(update.config);
      setPanes(update.config.panes ?? []);
      if (update.pending) {
        return "働く場所を保存した — 今のタスクには効かない。New chat で区切った後から";
      }
      return null;
    } catch (err) {
      return `働く場所の保存に失敗: ${errorMessage(err)}`;
    }
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

  // 同じ場所で働く窓の観測 (ADR-0009 Decision 6)。判断はしない。
  const shared = sharedPlaces(panes);

  // 締めの走っている窓ぶんのセクション (ADR-0012)。1つでもあれば1枚を出す。
  const closing = closingSections(panes, closingByPane);

  return (
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
        onAddPane={() => void handleAddPane()}
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
            開くたびに台帳の最新を読み直す方が、黙って古いViewを見せるより正しい。

            窓は格子に並ぶ (ADR-0009 Decision 2)。display:contents は grid セルに
            できないので、チャット面だけは実体の div で包む */}
        <div
          className={activePane === "chat" ? paneGridClass(panes.length) : undefined}
          style={activePane === "chat" ? undefined : { display: "none" }}
        >
          {panes.map((pane) => (
            <ChatPaneHost
              key={pane.id}
              pane={pane}
              closable={panes.length > 1}
              sharesPlace={shared.has(pane.id)}
              runCommandEnabled={guiConfig?.run_command === true}
              onLedgerChange={() => ledgerRefreshRef.current.schedule()}
              onWorkspaceChange={handleWorkspaceChange}
              onClose={(id) => void handleClosePane(id)}
              onExited={handlePaneExit}
              onClosingState={handleClosingState}
            />
          ))}
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
          <SessionPane
            sessionId={selectedSession}
            onLedgerChanged={() => {
              // 判定は台帳を書き換えるので、一覧の印も追随させる
              // (本体 ADR-0055 / GUI ADR-0010)。
              void refreshLedgerViews();
            }}
          />
        )}
      </main>
      {/* アプリの×の締め (ADR-0012 Decision 1)。窓の外 — サイドバーも含めて —
          全部を覆うので、格子の中ではなく main の外に置く。 */}
      {closing.length > 0 && (
        <AppClosingSheet
          sections={closing}
          onAnswer={(pane, send) => closingByPane.get(pane)?.answer(send)}
          onAbandon={() => {
            // Go 側の AbandonBoundary はアプリ全体を捨てる (ADR-0012 Decision 3)。
            // 呼ぶ口が窓ごとの断面にしか無いので先頭の窓を通しているだけで、
            // 窓を選んでいるわけではない — どの窓から呼んでも結末は同じ。
            closingByPane.get(closing[0].paneId)?.abandon();
          }}
        />
      )}
    </div>
  );
}

export default App;
