package main

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx context.Context

	// emit publishes one event to the frontend. A field, not a direct
	// wailsruntime call, so a test can capture the stream without a running
	// Wails app.
	emit func(name string, data ...interface{})
	// quit closes the app. emit と同じ理由でフィールド: 閉場の待ち合わせ
	// (closingPaneExited) が「いつ閉じるか」を決める以上、それは Wails を
	// 起動せずに試験できなければならない。
	quit func()
	// setMinSize applies the window's floor. 窓の並びで変わる (paneMinSize) ので、
	// これも起動時の固定値ではなく注入点として持つ。
	setMinSize func(width, height int)
	// afterExitsSent runs right after beforeClose finished sending /exit
	// (テスト専用の注入点。本番では nil)。「送っている間に全部の締めが終わって
	// いた」(nothingLeft) は子の終了タイミングとの競走で、この瞬間を外から
	// 突けないと決定論的に試験できない。
	afterExitsSent func()

	mu sync.Mutex
	// procs holds one running `tomobit chat` per pane (ADR-0009 Decision 2:
	// 1窓 = 1プロセス = 1セッション). Phase 1 runs exactly one — mainPane — so
	// behaviour is unchanged; the key exists so later phases add panes without
	// having to revisit every call site again.
	//
	// Entries are created lazily by ensureProcLocked and removed when the child
	// exits, so a missing key and a nil value both mean "nothing running here".
	procs     map[string]*chatProc
	stopping  bool
	guiConfig GUIConfig
	// closingBoundary は「窓の×で区切りを走らせている最中」(ADR-0005)。
	// beforeClose が /exit を送って閉窓を差し止めた時に立ち、以後の閉窓要求は
	// 差し止めずに通す — 答え終わった画面からの Quit も、もう一度押された×も
	// 同じ「もう待たない」の表明として扱う。
	closingBoundary bool
	// closingPanes は閉場の締めが走っている窓 (ADR-0009 Decision 4: 生きている窓
	// すべてに /exit を送り、全部の締めが終わるまで閉じない)。/exit が届いた窓
	// だけが入り、その窓の chat が終わるたびに抜ける。空になった瞬間が
	// 「待つものが無い」で、そこで初めてアプリを閉じる（closingPaneExited）。
	//
	// nil は「待つ集合が無い」— 閉場中でないか、「待たずに閉じる」で捨てた後。
	// 空の map（全部揃った直後）とは意味が違うので、同一視しない。
	closingPanes map[string]bool
	// abandonBoundary は「待たずに閉じる」と言われたことの記憶。shutdown が
	// 猶予を飛ばして即座に回収する（AbandonBoundary 参照）。
	abandonBoundary bool
}

// mainPane is the only pane Phase 1 opens. Named rather than "" so a pane id
// is always a real value in the ledger of events and in the frontend, and the
// day a second pane appears nothing has to be migrated.
const mainPane = "main"

func NewApp() *App {
	return &App{procs: map[string]*chatProc{}}
}

// procFor reads one pane's process. Caller holds a.mu.
func (a *App) procForLocked(pane string) *chatProc {
	if a.procs == nil {
		return nil
	}
	return a.procs[pane]
}

// livePanesLocked lists the panes with a running process, in no particular
// order. Caller holds a.mu.
func (a *App) livePanesLocked() []string {
	panes := make([]string, 0, len(a.procs))
	for pane, p := range a.procs {
		if p != nil {
			panes = append(panes, pane)
		}
	}
	return panes
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if a.emit == nil {
		a.emit = func(name string, data ...interface{}) {
			wailsruntime.EventsEmit(a.ctx, name, data...)
		}
	}
	if a.quit == nil {
		a.quit = func() { wailsruntime.Quit(a.ctx) }
	}
	if a.setMinSize == nil {
		a.setMinSize = func(width, height int) {
			wailsruntime.WindowSetMinSize(a.ctx, width, height)
		}
	}
	// ロード失敗はゼロ値続行（cmd/tomobit の cfg, cfgErr = config.Load() と同じ
	// 精神）: gui.json の typo 一つでアプリが起動できなくなるのは避ける。
	c, err := loadGUIConfig()
	if err != nil {
		fmt.Fprintln(os.Stderr, "tomobit-gui: gui.json の読み込みに失敗:", err)
	} else {
		a.mu.Lock()
		a.guiConfig = c
		a.mu.Unlock()
	}
	// 窓の並びは復元される (ADR-0009 Decision 3) のに、main.go が窓に渡す下限は
	// 1窓ぶんしかない。2列で終えた機械が2列で開き直った瞬間に潰れているのでは
	// 意味が無いので、読み込んだ並びで引き直す。読めなかった時のゼロ値は1窓
	// (PaneList) なので、既定の下限へ落ちる。
	a.applyMinSize(len(c.PaneList()))
}

// GetGUIConfig returns the current speaking-style config as saved on disk.
func (a *App) GetGUIConfig() (GUIConfig, error) {
	return loadGUIConfig()
}

// SaveGUIConfig persists c and updates the in-memory copy that the next
// spawned chat process reads (ADR-0001 追記: env はプロセス起動時に固定される
// ため、既に走っているセッションには効かない — 反映は次の New chat から)。
func (a *App) SaveGUIConfig(c GUIConfig) error {
	if err := saveGUIConfig(c); err != nil {
		return err
	}
	a.mu.Lock()
	a.guiConfig = c
	a.mu.Unlock()
	return nil
}

// WorkspaceUpdate is SetWorkspace's answer: the config as it now stands on
// disk, plus whether the running chat took the new places or they wait for the
// next task boundary.
type WorkspaceUpdate struct {
	Config GUIConfig `json:"config"`
	// Pending is true when a task was open, so the declaration was not sent —
	// the places are saved and take effect at the next boundary (New chat).
	Pending bool `json:"pending"`
}

// SetWorkspace persists the places Tomo works and, when a chat is running
// between tasks, declares them to it right away (ADR-0004 改訂 Decision 3 /
// 本体 ADR-0047 Decision 4 の /cd・/add-dir): 反映を次のプロセスまで待たせない。
//
// ディスクの現行 gui.json を読んでから2項目だけ差し替えるのは、設定ペインと
// この口が同じファイルを書くため — 呼び出し側が持っていた古い写しで喋り方や
// Provider を巻き戻さない。返す Config が画面の新しい真実になる。
//
// タスクが開いている間は宣言を送らない。送っても本体は「/new で区切ってから」
// と断るだけで、宣言の行数ぶん断り文句が会話面に並ぶ（実機で確認）。境界の
// 規律は本体のもののままで、GUI は「開いているか」という観測事実だけを見て
// 黙り、代わりに Pending を返して画面に一言言わせる。
func (a *App) SetWorkspace(pane, workingDir string, readDirs []string) (WorkspaceUpdate, error) {
	c, err := loadGUIConfig()
	if err != nil {
		return WorkspaceUpdate{}, fmt.Errorf("設定の読み込みに失敗: %w", err)
	}
	// 窓ごとの働く場所 (ADR-0009 Decision 3)。書き込む前に PaneList を通すのは、
	// 旧構成（panes キー無し）で保存が来たときに、その1窓ぶんを先に実体化して
	// おくため — さもないと最初の保存が既存の working_dir を消す。
	panes := append([]PaneConfig(nil), c.PaneList()...)
	found := false
	for i := range panes {
		if panes[i].ID == pane {
			panes[i].WorkingDir = workingDir
			panes[i].ReadDirs = readDirs
			found = true
		}
	}
	if !found {
		panes = append(panes, PaneConfig{ID: pane, WorkingDir: workingDir, ReadDirs: readDirs})
	}
	c.Panes = panes
	if err := saveGUIConfig(c); err != nil {
		return WorkspaceUpdate{}, fmt.Errorf("設定の保存に失敗: %w", err)
	}
	a.mu.Lock()
	a.guiConfig = c
	p := a.procForLocked(pane)
	a.mu.Unlock()
	if p == nil {
		// 走っていなければ宣言する相手がいない。次の起動が argv で持っていく。
		return WorkspaceUpdate{Config: c}, nil
	}
	if p.isTaskOpen() {
		return WorkspaceUpdate{Config: c, Pending: true}, nil
	}
	pc := c.PaneFor(pane)
	if err := p.write(workspaceDeclaration(pc.WorkingDir, pc.NormalizedReadDirs())); err != nil {
		return WorkspaceUpdate{Config: c, Pending: true}, fmt.Errorf("保存はできたが、走行中のチャットへ伝えられなかった: %w", err)
	}
	return WorkspaceUpdate{Config: c}, nil
}

// paneMinSize は窓の並びに対する画面の下限。格子は窓数で決まる (ADR-0009
// Decision 2 / frontend panes.ts paneGridClass): 1窓=1面、2窓=2列、3〜4窓=2列2行。
//
// 1窓ぶんの 640x480 のまま2列に割ると、入力欄の placeholder が1文字ずつ縦に
// 折れるところまで潰れる（実測）。下限は「窓が何個並ぶか」の関数であって、
// アプリ起動時に1度決める定数ではない。
//
// 960 と 620 は暫定値:
//   - 縦620には実測根拠がある — 1100x620 では4窓すべての入力欄と送信ボタンが
//     操作可能、縦500では作業バーが2行になった窓の入力欄が clip されて押せない
//   - 横の破綻点そのものは未計測。640で2列が壊れることだけが分かっている。
//     実機で詰めてから確定する
//
// 下限を上げた時に窓自体が広がるかは、macOS では Wails が引き受ける
// (WailsContext.m adjustWindowSize が現在のフレームを新しい下限まで押し戻す)。
// 他プラットフォームと、実際の見た目が意図どおりかは要実機確認。
func paneMinSize(panes int) (width, height int) {
	switch {
	case panes <= 1:
		// 固定260pxサイドバー + チャット面の最小実用幅（1窓時代の実測。これ未満は
		// 設定の textarea が1文字/行まで潰れる）。
		return 640, 480
	case panes == 2:
		return 960, 480
	default:
		return 960, 620
	}
}

// applyMinSize moves the window's floor to fit panes windows. 窓が増えた時
// (AddPane)・減った時 (ClosePane)・保存された並びで開き直した時 (startup) に
// 呼ぶ。Wails 未起動（テスト・startup 前）では setMinSize が nil なので黙る。
func (a *App) applyMinSize(panes int) {
	a.mu.Lock()
	set := a.setMinSize
	a.mu.Unlock()
	if set == nil {
		return
	}
	width, height := paneMinSize(panes)
	set(width, height)
}

// AddPane opens one more window (ADR-0009 Decision 2), up to MaxPanes, and
// returns the new layout. プロセスは起動しない — 空の窓が Provider の枠も
// quota も握らないのは遅延起動の副産物で、窓が増えてもそこは変わらない。
func (a *App) AddPane() ([]PaneConfig, error) {
	c, err := loadGUIConfig()
	if err != nil {
		return nil, fmt.Errorf("設定の読み込みに失敗: %w", err)
	}
	panes := append([]PaneConfig(nil), c.PaneList()...)
	if len(panes) >= MaxPanes {
		return panes, fmt.Errorf("窓は%d個まで", MaxPanes)
	}
	// 新しい窓は「まだどこでも働いていない」状態で生まれる: 直前の窓の場所を
	// 継がせると、同じ場所で2つ動く構成が既定になってしまう (Decision 6 が
	// 事実として言う羽目になる状態を、既定で作りに行かない)。
	panes = append(panes, PaneConfig{ID: newPaneID(panes)})
	c.Panes = panes
	if err := saveGUIConfig(c); err != nil {
		return nil, fmt.Errorf("設定の保存に失敗: %w", err)
	}
	a.mu.Lock()
	a.guiConfig = c
	a.mu.Unlock()
	a.applyMinSize(len(panes))
	return panes, nil
}

// ClosePane removes a window. 窓を閉じる = その窓のセッションを区切る
// (ADR-0009 Decision 4) なので、生きているプロセスへは EndTask と同じ /exit を
// 送る。true は「締めが走り始めた」— 画面はその窓の中にダイアログを出し、
// chat:exit が届いてから実際に窓を畳む。
//
// 最後の1窓は閉じない: 会話面が0個の GUI は、ただ壊れて見える。
func (a *App) ClosePane(pane string) (bool, error) {
	c, err := loadGUIConfig()
	if err != nil {
		return false, fmt.Errorf("設定の読み込みに失敗: %w", err)
	}
	panes := c.PaneList()
	if len(panes) <= 1 {
		return false, fmt.Errorf("最後の窓は閉じられない")
	}
	kept := make([]PaneConfig, 0, len(panes)-1)
	for _, p := range panes {
		if p.ID != pane {
			kept = append(kept, p)
		}
	}
	c.Panes = kept
	if err := saveGUIConfig(c); err != nil {
		return false, fmt.Errorf("設定の保存に失敗: %w", err)
	}
	a.mu.Lock()
	a.guiConfig = c
	p := a.procForLocked(pane)
	a.mu.Unlock()
	// 下限は先に緩める: 画面が窓を畳むのは chat:exit の後だが、下限を下げても
	// 今の窓は狭くならない（広げる側と違って、遅れて困る人が居ない）。
	a.applyMinSize(len(kept))
	if p == nil {
		return false, nil
	}
	if err := p.write("/exit\n"); err != nil {
		return false, fmt.Errorf("chat への /exit 送信に失敗: %w", err)
	}
	return true, nil
}

// GetPanes returns the saved window layout, migrating a pre-ADR-0009 config to
// one pane on the way out (PaneList) without writing anything.
func (a *App) GetPanes() ([]PaneConfig, error) {
	c, err := loadGUIConfig()
	if err != nil {
		return nil, err
	}
	return c.PaneList(), nil
}

// newPaneID picks an id no current pane holds. Ids are opaque to everything
// except the map key and the frontend's React key, so a counter is enough —
// but it must not collide with a pane that is still open, or two windows would
// share one chat process.
func newPaneID(panes []PaneConfig) string {
	taken := make(map[string]bool, len(panes))
	for _, p := range panes {
		taken[p.ID] = true
	}
	for i := 2; ; i++ {
		id := fmt.Sprintf("pane-%d", i)
		if !taken[id] {
			return id
		}
	}
}

// ChooseDirectory opens the OS folder picker and returns the chosen absolute
// path, or "" when the person cancels (ADR-0004 Decision 4: パスの手入力欄は
// 持たない — 存在しないパスという検証の面倒を初めから作らない)。startAt は
// ダイアログの初期位置で、空なら OS の既定に任せる。
func (a *App) ChooseDirectory(title, startAt string) (string, error) {
	return wailsruntime.OpenDirectoryDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title:            title,
		DefaultDirectory: startAt,
	})
}

// emitEvent forwards to emit unless the app is shutting down — the drain that
// runs while the window closes has no frontend left to paint on.
func (a *App) emitEvent(name string, data ...interface{}) {
	a.mu.Lock()
	stopping, emit := a.stopping, a.emit
	a.mu.Unlock()
	if stopping || emit == nil {
		return
	}
	emit(name, data...)
}

// SendLine sends one turn to the chat: a single- or multi-line turn (改行は
// 末尾 `\` 継続でエンコードされ、本体 cooked mode が1ターンに繋ぎ直す —
// ADR-0032 Decision 2), a slash command (/new, /exit もそのまま通る — 区切りの
// 尾部は本体の実装で走る), or an empty line — the boundary's Feedback question
// is answered with a bare Enter, and outside it the chat skips empty lines, so
// an accidental one costs nothing. エンコード結果は複数行になりうるが1回の Write
// で書く（既存の EPIPE 再起動リトライがそのまま効く）。
func (a *App) SendLine(pane, text string) error {
	line := encodeTurn(text)
	p, err := a.sendProc(pane)
	if err != nil {
		return err
	}
	return a.writeLine(pane, p, line)
}

// writeLine writes line to p, restarting the chat process once and
// resending on failure (EPIPE: the process died since the last send), so one
// crashed session costs a retry, not a dead app. The write itself happens
// under p.writeMu only — not a.mu — because the child may be mid-turn and
// not reading stdin: a full pipe buffer blocks the write, and a.mu must stay
// free during that block so shutdown (and any other SendLine/EndTask call)
// never queues behind it.
func (a *App) writeLine(pane string, p *chatProc, line string) error {
	err := p.write(line)
	if err == nil {
		return nil
	}
	a.invalidateProc(pane, p)
	p2, err2 := a.sendProc(pane)
	if err2 != nil {
		return fmt.Errorf("chat の再起動に失敗: %w (書き込み失敗: %v)", err2, err)
	}
	if err2 := p2.write(line); err2 != nil {
		return fmt.Errorf("chat への書き込みに失敗: %w", err2)
	}
	return nil
}

// sendProc returns the current chat process, spawning one under a.mu if none
// is running, but never once a.stopping is set: shutdown clears a.proc and
// sets a.stopping together in one lock hold, so any sendProc call that
// observes stopping is guaranteed to run after that hold — spawning past it
// would create a process shutdown has already stopped waiting for.
func (a *App) sendProc(pane string) (*chatProc, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.stopping {
		return nil, fmt.Errorf("chat はシャットダウン中のため送信できません")
	}
	if err := a.ensureProcLocked(pane); err != nil {
		return nil, err
	}
	return a.procForLocked(pane), nil
}

// invalidateProc drops a.proc if it still equals stale — the process a write
// just failed against — so the next sendProc spawns a replacement. The
// equality check keeps a slow caller (its write held no lock) from
// clobbering a process another goroutine already restarted in the meantime.
func (a *App) invalidateProc(pane string, stale *chatProc) {
	a.mu.Lock()
	if a.procs[pane] == stale {
		delete(a.procs, pane)
	}
	a.mu.Unlock()
}

// EndTask ends the running session by sending "/exit" — New chat's boundary
// (ADR-0001 追記: 反映境界 = セッション境界 = プロセス境界。GUIの「New chat」は
// /new でなく /exit で、次の送信が新プロセスを起動する — SendLine の
// 既存の EPIPE 再起動に乗る)。true はプロセスへ /exit を送ったことを示す。
// 走行中プロセスが無ければ false — 何も起動しない: 区切る対象が無いのに
// 新しいセッションを立てて即座に区切るのは、この呼び出しの意味に反する。
// a.stopping 下では a.proc は shutdown により同じロック下で既に nil にされて
// いるため、ここで改めて確認する必要はない。
func (a *App) EndTask(pane string) (bool, error) {
	a.mu.Lock()
	p := a.procForLocked(pane)
	a.mu.Unlock()
	if p == nil {
		return false, nil
	}
	if err := p.write("/exit\n"); err != nil {
		return false, fmt.Errorf("chat への /exit 送信に失敗: %w", err)
	}
	return true, nil
}

// eventBoundaryClosing tells the frontend the window's × started a boundary
// and is waiting on it (ADR-0005): the questions arrive on the ordinary
// chat:view stream, so this carries only the addressees — which windows the
// boundary is actually running in.
const eventBoundaryClosing = "app:closing"

// ClosingInfo names the panes whose boundary started (ADR-0012 Decision 2).
//
// 締めが走るのは /exit が届いた窓だけ（生きている chat がある窓、かつ書き込みが
// 通った窓）なのに、この合図が宛先を持たなかった頃は全窓が締めモードに入って
// いた。会話していない窓まで「Tomoが今回を振り返っている…」を出し、来ない exit を
// 待つ顔をする — 待ち合わせ（closingPanes）からは外れているので閉窓は詰まらない
// が、表示が実態と食い違う。
//
// 並びに意味は持たせない。セクションの順は保存された窓の並び (gui.json) で、
// 画面はそちらを正本にする。
type ClosingInfo struct {
	Panes []string `json:"panes"`
}

// beforeClose runs on the window's × (Wails OnBeforeClose; true = 閉じない).
// 窓を閉じる前に走る区切り(ADR-0005 Decision 1): 生きている chat があれば
// New chat と同じ /exit を送って閉窓を差し止め、締めの質問を画面へ出させる。
// 待たされる15秒の正体（本体が Feedback → 知覚 → 質問 → 鏡 を走らせている）を
// 凍った窓の裏に隠さず、答えられる形で前に出す。
//
// 二度目の×はもう差し止めない: 一度出した器官の前で「もう待たない」と言えるのは
// 人だけで、GUI がそれを勝手に延長する理由が無い（ForceQuit と同じ結末＝
// shutdown の猶予つき回収へ落ちる）。
func (a *App) beforeClose(_ context.Context) bool {
	a.mu.Lock()
	already := a.closingBoundary
	panes := a.livePanesLocked()
	procs := make([]*chatProc, 0, len(panes))
	for _, pane := range panes {
		procs = append(procs, a.procs[pane])
	}
	if len(procs) > 0 && !already {
		a.closingBoundary = true
		// 待つ集合は「送る前に、生きている窓ぶんを丸ごと」立てる。送信の最中に
		// 子が終われば closingPaneExited が走るので、後から埋める形にすると
		// その瞬間の空集合を「全部終わった」と読み違え、まだ知覚を書いている
		// 窓を道連れに閉じる。送れなかった窓は下で抜く。
		a.closingPanes = make(map[string]bool, len(panes))
		for _, pane := range panes {
			a.closingPanes[pane] = true
		}
	}
	a.mu.Unlock()
	if len(procs) == 0 || already {
		return false
	}
	// 送れないなら差し止める理由も無い: 区切りは走らないので、そのまま閉じて
	// shutdown の回収に任せる（失敗の診断は stderr 面へ — もう読む窓は無いが、
	// 握り潰すよりは残す）。
	//
	// 期限を切って書くのは、ここが UI スレッドだから (2026-07-26 の応答停止への
	// 修正 / chat.go writeWithin)。子がターンの最中で stdin を読んでいなければ
	// 素の write は止まりうる。凍った窓から逃げるための器官(ADR-0005)が、
	// その凍った瞬間にだけ窓を道連れにするのでは筋が通らない。期限切れは
	// 「区切りを走らせられなかった」であって失敗ではないので、差し止めずに閉じる。
	//
	// 窓が複数あるなら、締めは窓の数だけ立つ (ADR-0009 Decision 4): 全部へ /exit を
	// 送り、1つでも走り出したなら閉窓を差し止める。1つも送れなかった時だけ、
	// 差し止める理由が無いのでそのまま閉じる。実際に閉じるのは全部の締めが
	// 終わった時で、その待ち合わせは closingPanes が引き受ける。
	sent := 0
	unreached := make([]string, 0, len(procs))
	for i, p := range procs {
		if err := p.writeWithin("/exit\n", beforeCloseWriteGrace); err != nil {
			fmt.Fprintf(os.Stderr, "tomobit-gui: 閉窓時の /exit 送信に失敗 (%s): %v\n", panes[i], err)
			unreached = append(unreached, panes[i])
			continue
		}
		sent++
	}
	if sent == 0 {
		a.mu.Lock()
		a.closingBoundary = false
		a.closingPanes = nil
		a.mu.Unlock()
		return false
	}
	if a.afterExitsSent != nil {
		a.afterExitsSent()
	}
	a.mu.Lock()
	// 届かなかった窓の締めは走っていない。待つ集合に残すと、答え終わった窓が
	// 全部揃っても最後の1つが永遠に来ず、閉じない窓になる。
	for _, pane := range unreached {
		delete(a.closingPanes, pane)
	}
	// 画面へ渡すのは、この時点で締めが走っている窓ぶん (ADR-0012 Decision 2)。
	// 待つ集合そのものを写すので、「届かなかった窓は待たない」と「載せない」が
	// 同じ1つの事実から出る — 2か所で別々に絞ると、片方だけ直した日に食い違う。
	closing := make([]string, 0, len(a.closingPanes))
	for _, pane := range panes {
		if a.closingPanes[pane] {
			closing = append(closing, pane)
		}
	}
	a.mu.Unlock()
	// 送っている間に全部終わっていたなら待つものはもう無い。ここで差し止めると
	// 誰も閉じに来ず、×をもう一度押させることになる。
	if len(closing) == 0 {
		return false
	}
	a.emitEvent(eventBoundaryClosing, ClosingInfo{Panes: closing})
	return true
}

// closingPaneExited は閉場中の窓が1つ締め終わったことの記帳。最後の1つが終わって
// 初めてアプリを閉じる (ADR-0009 Decision 4: 全部の締めが終わるまで閉じない)。
//
// 最初に終わった窓で閉じてはいけない。締めは窓の数だけ並走していて、遅い窓は
// まだ知覚を書いている — そこで閉じれば、その窓のセッションは task.finished を
// 記帳できないまま消える。ADR-0005 が閉窓のたびに失われるのを直した信号が、
// 窓を増やした分だけまた失われることになる。
//
// 待ち合わせを Go に置くのは、画面には自分の窓しか見えないため: 窓ごとに独立した
// フックが「自分の締めが終わった」を知っても、他の窓がまだ答えている最中かどうかは
// そこからは判らない。集合を持っているのは /exit を送った側だけである。
func (a *App) closingPaneExited(pane string) {
	a.mu.Lock()
	// stopping は既に窓が閉じた後の回収。closingPanes == nil は待つ集合そのものが
	// 無い（閉場中でないか、「待たずに閉じる」で捨てた後）— どちらも決める余地が
	// 無い。nil を空集合と同一視すると、捨てた後の exit で二度目の Quit を呼ぶ。
	if a.stopping || !a.closingBoundary || a.closingPanes == nil {
		a.mu.Unlock()
		return
	}
	delete(a.closingPanes, pane)
	last := len(a.closingPanes) == 0
	if last {
		// 最後の1つを数えたら集合ごと捨てる（AbandonBoundary と同じ作法）。
		// quit が同期でプロセスを終えると信じて空 map を残すと、終わり切る前に
		// 別経路の exit が届いた場合に len==0 がもう一度真になり、二度目の
		// Quit を呼ぶ。
		a.closingPanes = nil
	}
	a.mu.Unlock()
	if !last {
		return
	}
	// a.mu の外で呼ぶ: Quit は OnBeforeClose を呼び戻し、その中で同じ mutex を取る。
	a.quitApp()
}

// quitApp closes the app through the injected quit (see the quit field).
// 未配線（startup 前・テスト）では黙る — emitEvent と同じ姿勢。
func (a *App) quitApp() {
	a.mu.Lock()
	quit := a.quit
	a.mu.Unlock()
	if quit == nil {
		return
	}
	quit()
}

// AbandonBoundary is 「待たずに閉じる」(ADR-0005 Decision 3): the person
// declined to wait for the organs, so shutdown stops giving them the grace and
// reaps the child at once. 猶予を残したまま閉じると、答えないと決めた後に
// 15秒フリーズするという、この設計が直したはずの症状がそのまま戻る。
//
// 失うものは正直に言う: 知覚は途中で止まり、そのセッションの task.finished は
// 記帳されない（猶予切れの Kill で従来から起きていたのと同じ結末）。積み残しは
// 後から `tomobit perceive` が消化する。
func (a *App) AbandonBoundary() {
	a.mu.Lock()
	a.abandonBoundary = true
	// 待つ集合は空にするのではなく捨てる。「待たずに閉じる」の後も子は死んで
	// 締めの終わりを届けるので、空の集合を残すとその最後の1つが「全部揃った」の
	// 経路でもう一度閉じに行く。閉じるのはこの下の1回でよい。
	a.closingPanes = nil
	a.mu.Unlock()
	a.quitApp()
}

// shutdown closes the chat's stdin — the terminal's Ctrl-D: the boundary
// organs (Feedback は EOF で無信号 → 知覚) run in the body — and waits for the
// process. One that outlives the grace is killed, then reaped: the app must
// not hang on quit, and a Kill without the Wait would leak the child.
//
// 窓の×の経路では beforeClose が先に /exit を送っており、ここへ来る時点で
// 区切りは済んでいるか、人が「待たずに閉じる」と言ったかのどちらか。猶予は
// 後者のための天井として残る（前者では p が既に居ないので即座に返る）。
func (a *App) shutdown(_ context.Context) {
	a.mu.Lock()
	a.stopping = true
	procs := make([]*chatProc, 0, len(a.procs))
	for _, p := range a.procs {
		if p != nil {
			procs = append(procs, p)
		}
	}
	a.procs = map[string]*chatProc{}
	abandon := a.abandonBoundary
	a.mu.Unlock()
	if len(procs) == 0 {
		return
	}
	// 猶予は窓ごとに数え直さない: 人が待つのは1回で、窓が4つあるからといって
	// 4倍待たされる理由は無い。stdin は全部先に閉じ、期限は全体で1つ持つ。
	for _, p := range procs {
		p.stdin.Close()
	}
	if abandon {
		for _, p := range procs {
			p.cmd.Process.Kill()
			<-p.done
		}
		return
	}
	deadline := time.After(chatShutdownGrace)
	for _, p := range procs {
		select {
		case <-p.done:
		case <-deadline:
			p.cmd.Process.Kill()
			<-p.done
		}
	}
}
