package main

import (
	"context"
	"io"
	"os"
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
