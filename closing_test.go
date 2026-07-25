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
	app.proc = proc

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
	app.proc = proc

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
	app.proc = &chatProc{stdin: w, done: make(chan struct{})}

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

// 「待たずに閉じる」は猶予を捨てる。ここで chatShutdownGrace を待つと、
// 答えないと決めた後に15秒固まる — この設計が直したはずの症状そのもの。
func TestShutdown_待たずに閉じるなら猶予を待たない(t *testing.T) {
	app := NewApp()
	app.emit = func(string, ...interface{}) {}
	proc := blockedProc(t)
	app.proc = proc
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
