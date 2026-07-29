package main

// ADR-0005: 窓の×は即座には閉じない。ここで固定するのは「差し止めるのは
// いつか」「何を送るか」「二度目はどうなるか」— 画面の見た目ではなく、
// 閉窓と子プロセスの間の契約。

import (
	"bufio"
	"context"
	"os"
	"os/exec"
	"sync"
	"testing"
	"time"
)

// pipedProc returns a chatProc whose stdin is a real pipe with a reader, so a
// write completes instead of blocking (blockedProc の逆の道具)。
func pipedProc(t *testing.T) (*chatProc, *bufio.Reader) {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { r.Close(); w.Close() })
	return &chatProc{stdin: w, done: make(chan struct{})}, bufio.NewReader(r)
}

// deadProc returns a chatProc whose reader is already gone: 書けば EPIPE で、
// 「既に死んだ chat へは /exit を送れない」場面を作る。
func deadProc(t *testing.T) *chatProc {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	r.Close()
	t.Cleanup(func() { w.Close() })
	return &chatProc{stdin: w, done: make(chan struct{})}
}

// recordQuits taps the app's quit — wailsruntime.Quit は Wails 無しでは呼べない
// ので、emit と同じ注入点で「閉じた」を観測する。
func recordQuits(app *App) <-chan struct{} {
	quits := make(chan struct{}, 4)
	app.quit = func() { quits <- struct{}{} }
	return quits
}

func assertQuit(t *testing.T, quits <-chan struct{}, msg string) {
	t.Helper()
	select {
	case <-quits:
	case <-time.After(2 * time.Second):
		t.Fatal(msg)
	}
}

func assertNoQuit(t *testing.T, quits <-chan struct{}, msg string) {
	t.Helper()
	select {
	case <-quits:
		t.Fatal(msg)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestBeforeClose_走行中のchatには区切りを送って閉窓を差し止める(t *testing.T) {
	app := NewApp()
	var mu sync.Mutex
	var events []string
	app.emit = func(name string, _ ...interface{}) {
		mu.Lock()
		events = append(events, name)
		mu.Unlock()
	}
	proc, r := pipedProc(t)
	app.procs[mainPane] = proc

	if !app.beforeClose(context.Background()) {
		t.Fatal("beforeClose = false — 区切りを走らせる前に閉じてしまう")
	}

	line, err := r.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if line != "/exit\n" {
		t.Errorf("送られた行 = %q, want %q（New chat と同じ区切りの宣言）", line, "/exit\n")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(events) != 1 || events[0] != eventBoundaryClosing {
		t.Errorf("events = %v, want [%s] — 画面へ締めの開始を知らせない", events, eventBoundaryClosing)
	}
}

func TestBeforeClose_chatが居なければそのまま閉じる(t *testing.T) {
	app := NewApp()
	app.emit = func(string, ...interface{}) {}

	if app.beforeClose(context.Background()) {
		t.Error("beforeClose = true — 区切る相手が居ないのに窓が閉じない")
	}
}

// 二度目の×は「もう待たない」の表明。ここで差し止め続けると、締めから
// 降りる道が「待たずに閉じる」ボタン1つだけになり、窓が閉じない窓になる。
func TestBeforeClose_二度目は差し止めない(t *testing.T) {
	app := NewApp()
	app.emit = func(string, ...interface{}) {}
	proc, r := pipedProc(t)
	app.procs[mainPane] = proc

	if !app.beforeClose(context.Background()) {
		t.Fatal("一度目で差し止めていない")
	}
	if _, err := r.ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	if app.beforeClose(context.Background()) {
		t.Error("beforeClose(2回目) = true — ×を押し続けても閉じない")
	}
}

// 送れない相手（既に死んだ chat）に閉窓を人質に取らせない: 区切りは走らない
// のだから、差し止める理由も無い。
func TestBeforeClose_送信に失敗したら差し止めない(t *testing.T) {
	app := NewApp()
	app.emit = func(string, ...interface{}) {}
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	r.Close() // 読み手が居ない = write は EPIPE
	app.procs[mainPane] = &chatProc{stdin: w, done: make(chan struct{})}

	if app.beforeClose(context.Background()) {
		t.Error("beforeClose = true — /exit すら送れないのに窓が閉じない")
	}
	app.mu.Lock()
	closing := app.closingBoundary
	app.mu.Unlock()
	if closing {
		t.Error("closingBoundary が立ったまま — 次の×が『二度目』扱いになる")
	}
}

// 2026-07-26 の応答停止の再発防止。beforeClose は Wails の UI スレッドで走るので、
// 子が stdin を読んでいない（ターンの最中＝まさに人が窓を閉じたくなる状況）
// ときに素の write で止まると、凍った窓から逃げる手段そのものが凍る。
func TestBeforeClose_子が読んでいなくてもUIスレッドを止めない(t *testing.T) {
	app := NewApp()
	app.emit = func(string, ...interface{}) {}
	app.procs[mainPane] = blockedProc(t)

	var stop bool
	waitOrFail(t, 2*time.Second,
		"子が stdin を読んでいないだけで beforeClose が返らない（窓が固まる）",
		func() { stop = app.beforeClose(context.Background()) })

	// 送れなかった以上、区切りは走らない。差し止めれば「閉じないのに何も
	// 起きない窓」になるので、そのまま閉じて shutdown の回収へ落とす。
	if stop {
		t.Fatal("区切りを送れていないのに閉窓を差し止めている")
	}
	app.mu.Lock()
	defer app.mu.Unlock()
	if app.closingBoundary {
		t.Fatal("走らなかった区切りの最中だと記憶している — 次の×が素通しになる")
	}
}

// ADR-0009 Decision 4: 生きている窓すべてに /exit を送り、全部の締めが終わるまで
// 閉じない。最初に終わった窓で閉じると、まだ知覚を書いている窓のセッションが
// task.finished を記帳できないまま消える — ADR-0005 が直した信号の欠落が、窓を
// 増やした分だけ戻る。
func TestClosingBoundary_全部の窓の締めが終わるまで閉じない(t *testing.T) {
	app := NewApp()
	app.emit = func(string, ...interface{}) {}
	quits := recordQuits(app)
	fast, fastIn := pipedProc(t)
	slow, slowIn := pipedProc(t)
	app.procs["fast"] = fast
	app.procs["slow"] = slow

	if !app.beforeClose(context.Background()) {
		t.Fatal("beforeClose = false — 2窓の締めを走らせる前に閉じてしまう")
	}
	for name, in := range map[string]*bufio.Reader{"fast": fastIn, "slow": slowIn} {
		line, err := in.ReadString('\n')
		if err != nil || line != "/exit\n" {
			t.Fatalf("窓 %s へ区切りが届いていない: %q %v", name, line, err)
		}
	}

	app.reapProc("fast", fast, nil)
	assertNoQuit(t, quits, "先に終わった窓だけで閉じた — もう片方の知覚が記帳されないまま消える")

	app.reapProc("slow", slow, nil)
	assertQuit(t, quits, "全部の締めが終わっても閉じない — ×をもう一度押させることになる")
}

// 区切りが届かなかった窓は待たない: その窓の締めは走っていないので、答え終わった
// 窓が全部揃っても最後の1つが永遠に来ず、閉じない窓になる。
func TestClosingBoundary_区切りを送れなかった窓は待たない(t *testing.T) {
	app := NewApp()
	app.emit = func(string, ...interface{}) {}
	quits := recordQuits(app)
	live, _ := pipedProc(t)
	app.procs["live"] = live
	app.procs["dead"] = deadProc(t)

	if !app.beforeClose(context.Background()) {
		t.Fatal("beforeClose = false — 1窓でも送れたなら締めを待つ")
	}

	app.reapProc("live", live, nil)
	assertQuit(t, quits, "送れた窓が全部終わっても閉じない — 届かなかった /exit を待ち続けている")
}

// ADR-0012 Decision 2: 締めモードに入るのは /exit が届いた窓だけ。宛先を持たない
// 合図のままだと、会話していない窓・既に死んだ chat の窓まで「Tomoが今回を
// 振り返っている…」を出し、来ない exit を待つ顔をする。
func TestBeforeClose_締めが走った窓だけを画面へ載せる(t *testing.T) {
	app := NewApp()
	var mu sync.Mutex
	var announced []ClosingInfo
	app.emit = func(name string, data ...interface{}) {
		if name != eventBoundaryClosing {
			return
		}
		mu.Lock()
		defer mu.Unlock()
		if len(data) != 1 {
			t.Errorf("%s の payload = %v, want 締め対象の窓一覧1つ", name, data)
			return
		}
		info, ok := data[0].(ClosingInfo)
		if !ok {
			t.Errorf("%s の payload = %#v, want ClosingInfo", name, data[0])
			return
		}
		announced = append(announced, info)
	}
	live, _ := pipedProc(t)
	app.procs["live"] = live
	app.procs["dead"] = deadProc(t)

	if !app.beforeClose(context.Background()) {
		t.Fatal("beforeClose = false — 1窓でも送れたなら締めを待つ")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(announced) != 1 {
		t.Fatalf("%s = %d件, want 1件", eventBoundaryClosing, len(announced))
	}
	got := announced[0].Panes
	if len(got) != 1 || got[0] != "live" {
		t.Errorf("締め対象 = %v, want [live] — /exit が届かなかった窓まで締めモードに入る", got)
	}
}

// 送っている間に全部の締めが終わっていたら、待つものはもう無いので差し止めない
// — 差し止めると誰も閉じに来ず、×をもう一度押させることになる。子の終了との
// 競走なので、送信直後の瞬間はテスト注入点 (afterExitsSent) で突く。
func TestBeforeClose_送信中に全部の締めが終わっていたら差し止めない(t *testing.T) {
	app := NewApp()
	app.emit = func(string, ...interface{}) {}
	quits := recordQuits(app)
	fast, _ := pipedProc(t)
	app.procs["fast"] = fast
	// 送り終えた瞬間、唯一の窓の締めが終わっている — closingPaneExited が
	// この時点で Quit まで済ませる（全部揃ったのだから閉じてよい）。
	app.afterExitsSent = func() { app.reapProc("fast", fast, nil) }

	if app.beforeClose(context.Background()) {
		t.Fatal("beforeClose = true — 待つものが無いのに差し止めた。誰も閉じに来ない")
	}
	assertQuit(t, quits, "全部揃ったのに閉じに行っていない")
	assertNoQuit(t, quits, "閉じる経路が二重に走った — Quit は1回でよい")
}

// 「待たずに閉じる」はその場で閉じる。後から届く締めの終わりで二度目を呼ばない
// —— 待つ集合は空にするのではなく捨てる、の観測。
func TestAbandonBoundary_その場で閉じ後から届く終了で二度閉じない(t *testing.T) {
	app := NewApp()
	app.emit = func(string, ...interface{}) {}
	quits := recordQuits(app)
	a, _ := pipedProc(t)
	b, _ := pipedProc(t)
	app.procs["a"] = a
	app.procs["b"] = b
	if !app.beforeClose(context.Background()) {
		t.Fatal("beforeClose = false — 締めが立っていない状態から始まっている")
	}

	app.AbandonBoundary()
	assertQuit(t, quits, "「待たずに閉じる」がその場で閉じない")

	app.reapProc("a", a, nil)
	app.reapProc("b", b, nil)
	assertNoQuit(t, quits, "待たずに閉じた後に届いた終了で、もう一度閉じに行っている")
}

// 「待たずに閉じる」は猶予を捨てる。ここで chatShutdownGrace を待つと、
// 答えないと決めた後に15秒固まる — この設計が直したはずの症状そのもの。
func TestShutdown_待たずに閉じるなら猶予を待たない(t *testing.T) {
	app := NewApp()
	app.emit = func(string, ...interface{}) {}
	proc := blockedProc(t)
	app.procs[mainPane] = proc
	app.abandonBoundary = true

	// Kill する実プロセスは無いので、回収済みを装って done を閉じておく
	// （Kill 呼び出し自体は下の nil ガードで踏まないよう cmd を立てる）。
	proc.cmd = exitedCmd(t)
	close(proc.done)

	waitOrFail(t, 2*time.Second,
		"待たずに閉じると言ったのに shutdown が猶予を待っている",
		func() { app.shutdown(context.Background()) })
}

// exitedCmd は Kill が安全に呼べる、既に終了済みの *exec.Cmd。
func exitedCmd(t *testing.T) *exec.Cmd {
	t.Helper()
	cmd := exec.Command("true")
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	return cmd
}
