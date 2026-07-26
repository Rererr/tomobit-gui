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
	// ロード失敗はゼロ値続行（cmd/tomobit の cfg, cfgErr = config.Load() と同じ
	// 精神）: gui.json の typo 一つでアプリが起動できなくなるのは避ける。
	if c, err := loadGUIConfig(); err != nil {
		fmt.Fprintln(os.Stderr, "tomobit-gui: gui.json の読み込みに失敗:", err)
	} else {
		a.mu.Lock()
		a.guiConfig = c
		a.mu.Unlock()
	}
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
// chat:view stream, so this carries no payload — it only says which mode the
// screen is in.
const eventBoundaryClosing = "app:closing"

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
	// 差し止める理由が無いのでそのまま閉じる。
	sent := 0
	for i, p := range procs {
		if err := p.writeWithin("/exit\n", beforeCloseWriteGrace); err != nil {
			fmt.Fprintf(os.Stderr, "tomobit-gui: 閉窓時の /exit 送信に失敗 (%s): %v\n", panes[i], err)
			continue
		}
		sent++
	}
	if sent == 0 {
		a.mu.Lock()
		a.closingBoundary = false
		a.mu.Unlock()
		return false
	}
	a.emitEvent(eventBoundaryClosing)
	return true
}

// QuitNow closes the window for real — called by the screen when the boundary
// is done (chat:exit が届いた＝待つものが無い)。beforeClose の差し止めは既に
// 降りている（closingBoundary が立っている）ので、そのまま閉じる。
func (a *App) QuitNow() {
	wailsruntime.Quit(a.ctx)
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
	a.mu.Unlock()
	wailsruntime.Quit(a.ctx)
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
