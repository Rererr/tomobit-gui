package main

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// blockedProc returns a chatProc backed by a real OS pipe whose read end
// nobody drains — the write end fills to capacity and further writes block,
// the same way `tomobit chat`'s stdin blocks when it is mid-turn and not
// reading. t.Cleanup closes the read end so the test process doesn't leak fds.
func blockedProc(t *testing.T) *chatProc {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { r.Close() })
	fillStarted := make(chan struct{})
	go func() {
		close(fillStarted)
		// Larger than any realistic pipe buffer so the write blocks for as
		// long as the test needs, until shutdown closes w.
		_, _ = io.WriteString(w, strings.Repeat("x", 8<<20))
	}()
	<-fillStarted
	time.Sleep(200 * time.Millisecond) // let the fill actually reach the blocking write
	return &chatProc{stdin: w, done: make(chan struct{})}
}

// waitOrFail runs fn in a goroutine and fails the test if it doesn't finish
// within timeout — the observable symptom of the mutex-held-across-blocking-
// write bug this file guards against is exactly "shutdown never returns".
func waitOrFail(t *testing.T, timeout time.Duration, msg string, fn func()) {
	t.Helper()
	done := make(chan struct{})
	go func() {
		fn()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(timeout):
		t.Fatal(msg)
	}
}

func TestShutdown_SendLineが送信ブロック中でも進む(t *testing.T) {
	app := NewApp()
	app.emit = func(string, ...interface{}) {}
	proc := blockedProc(t)
	app.proc = proc

	go app.SendLine("進まないはずの一言")
	time.Sleep(100 * time.Millisecond) // let SendLine reach the blocking write

	close(proc.done) // shutdown's grace wait shouldn't matter to this test
	waitOrFail(t, 3*time.Second,
		"SendLine の書き込みブロックに shutdown が道連れにされて進まない",
		func() { app.shutdown(context.Background()) })
}

func TestShutdown_EndTaskが送信ブロック中でも進む(t *testing.T) {
	app := NewApp()
	app.emit = func(string, ...interface{}) {}
	proc := blockedProc(t)
	app.proc = proc

	go app.EndTask()
	time.Sleep(100 * time.Millisecond) // let EndTask reach the blocking write

	close(proc.done)
	waitOrFail(t, 3*time.Second,
		"EndTask の書き込みブロックに shutdown が道連れにされて進まない",
		func() { app.shutdown(context.Background()) })
}

// ADR-0004 Decision 1: 消えた作業ディレクトリでは chat を起動せず、どの設定が
// 悪いかを名指す（tomobit バイナリ探索より先に判じるので、本体の有無に依らない）。
func TestSendLine_作業ディレクトリが消えていれば起動せず名指しで返す(t *testing.T) {
	app := NewApp()
	app.emit = func(string, ...interface{}) {}
	gone := filepath.Join(t.TempDir(), "gone")
	app.guiConfig = GUIConfig{WorkingDir: gone}

	err := app.SendLine("こんにちは")
	if err == nil {
		t.Fatal("消えた作業ディレクトリのまま chat を起動した")
	}
	if !strings.Contains(err.Error(), gone) {
		t.Errorf("どの設定が悪いか名指さない: %v", err)
	}
	app.mu.Lock()
	proc := app.proc
	app.mu.Unlock()
	if proc != nil {
		t.Error("起動を止めるべき場面でプロセスが立った")
	}
}

func TestSendLine_シャットダウン中は新しいプロセスを起動しない(t *testing.T) {
	app := NewApp()
	app.emit = func(string, ...interface{}) {}
	app.mu.Lock()
	app.stopping = true
	app.mu.Unlock()

	err := app.SendLine("こんにちは")
	if err == nil || !strings.Contains(err.Error(), "シャットダウン中") {
		t.Fatalf("stopping 中の SendLine が想定したエラーを返さない（新規プロセスを起動した可能性）: %v", err)
	}
}

// ADR-0004 改訂 Decision 3: 作業バーの保存は gui.json の他の項目を巻き戻さない
// （設定ペインと同じファイルを書くため）。走行中のチャットには本体のコマンド
// 語彙で宣言し、反映を次のプロセスまで待たせない（本体 ADR-0047 Decision 4）。
func TestSetWorkspace_他の設定を保ったまま保存し走行中のチャットへ宣言する(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := os.MkdirAll(filepath.Join(home, ".tomobit"), 0o755); err != nil {
		t.Fatal(err)
	}
	// 設定ペイン側が書いた状態を先に置く。
	if err := saveGUIConfig(GUIConfig{SpeakingStyle: "関西弁で", Provider: "codex"}); err != nil {
		t.Fatal(err)
	}

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	app := NewApp()
	app.emit = func(string, ...interface{}) {}
	app.proc = &chatProc{stdin: w, done: make(chan struct{})}

	work, extra := t.TempDir(), t.TempDir()
	got, err := app.SetWorkspace(work, []string{extra, extra})
	if err != nil {
		t.Fatal(err)
	}
	if got.Config.SpeakingStyle != "関西弁で" || got.Config.Provider != "codex" {
		t.Errorf("他の設定が巻き戻った: %+v", got.Config)
	}
	if got.Config.WorkingDir != work {
		t.Errorf("working_dir = %q, want %q", got.Config.WorkingDir, work)
	}
	if got.Pending {
		t.Error("タスクが開いていないのに保留にした")
	}
	// ディスクにも残る（次の起動が読む真実）。
	saved, err := loadGUIConfig()
	if err != nil {
		t.Fatal(err)
	}
	if saved.WorkingDir != work || saved.SpeakingStyle != "関西弁で" {
		t.Errorf("保存された gui.json が食い違う: %+v", saved)
	}

	want := "/cd " + work + "\n/add-dir clear\n/add-dir " + extra + "\n"
	buf := make([]byte, len(want)+64)
	n, err := io.ReadFull(r, buf[:len(want)])
	if err != nil {
		t.Fatal(err)
	}
	if string(buf[:n]) != want {
		t.Errorf("宣言 = %q, want %q", string(buf[:n]), want)
	}
}

// 走っていなければ宣言する相手がいない — 保存だけして黙って成功する。
func TestSetWorkspace_走行中のチャットが無ければ保存だけする(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	app := NewApp()
	app.emit = func(string, ...interface{}) {}
	work := t.TempDir()
	if _, err := app.SetWorkspace(work, nil); err != nil {
		t.Fatalf("プロセス不在で失敗した: %v", err)
	}
	saved, err := loadGUIConfig()
	if err != nil {
		t.Fatal(err)
	}
	if saved.WorkingDir != work {
		t.Errorf("working_dir = %q, want %q", saved.WorkingDir, work)
	}
}

// タスクが開いている間は宣言を送らない (ADR-0004 改訂 Decision 3): 送っても本体は
// 「/new で区切ってから」と断るだけで、宣言の行数ぶん断り文句が会話面に並ぶ。
// 保存はして Pending を返し、画面に一言言わせる。
func TestSetWorkspace_タスクの途中では宣言を送らず保留を返す(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	app := NewApp()
	app.emit = func(string, ...interface{}) {}
	proc := &chatProc{stdin: w, done: make(chan struct{})}
	app.proc = proc
	// view ストリームの task.started が「開いた」の観測（本体 ADR-0032 の契約）。
	app.emitViewLine([]byte(`{"type":"task.started","sid":"s-1"}`))
	if !proc.isTaskOpen() {
		t.Fatal("task.started を見てもタスクが開いたことになっていない")
	}

	work := t.TempDir()
	got, err := app.SetWorkspace(work, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Pending {
		t.Error("タスクの途中なのに保留を返さない")
	}
	if got.Config.WorkingDir != work {
		t.Errorf("保留でも保存はする: %+v", got.Config)
	}
	// パイプには1バイトも書かれていない。
	if err := w.SetReadDeadline(time.Now()); err == nil {
		t.Skip("書き込み側に読み取り期限は設定できない環境")
	}
	done := make(chan int, 1)
	go func() {
		buf := make([]byte, 64)
		n, _ := r.Read(buf)
		done <- n
	}()
	select {
	case n := <-done:
		t.Errorf("タスクの途中なのに %d バイト宣言を送った", n)
	case <-time.After(200 * time.Millisecond):
	}

	// 区切れば（task.finished）また届くようになる。
	app.emitViewLine([]byte(`{"type":"task.finished","sid":"s-1"}`))
	if proc.isTaskOpen() {
		t.Fatal("task.finished を見てもタスクが開いたままになっている")
	}
	if got, err := app.SetWorkspace(work, nil); err != nil || got.Pending {
		t.Errorf("区切った後は宣言を送るべき: %+v %v", got, err)
	}
	if n := <-done; n == 0 {
		t.Error("区切った後の宣言が届いていない")
	}
}
