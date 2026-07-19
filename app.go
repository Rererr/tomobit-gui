package main

import (
	"context"
	"fmt"
	"io"
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

	mu       sync.Mutex
	proc     *chatProc
	stopping bool
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if a.emit == nil {
		a.emit = func(name string, data ...interface{}) {
			wailsruntime.EventsEmit(a.ctx, name, data...)
		}
	}
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

// SendLine sends one line to the chat: a turn, a slash command (/new, /exit
// もそのまま通る — 区切りの尾部は本体の実装で走る), or an empty line — the
// boundary's Feedback question is answered with a bare Enter, and outside it
// the chat skips empty lines, so an accidental one costs nothing.
func (a *App) SendLine(text string) error {
	line := flattenTurnLine(text) + "\n"
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.ensureProcLocked(); err != nil {
		return err
	}
	if _, err := io.WriteString(a.proc.stdin, line); err != nil {
		// The process died since the last send (EPIPE). Restart once and
		// resend, so one crashed session costs a retry, not a dead app.
		a.proc = nil
		if err2 := a.ensureProcLocked(); err2 != nil {
			return fmt.Errorf("chat の再起動に失敗: %w (書き込み失敗: %v)", err2, err)
		}
		if _, err2 := io.WriteString(a.proc.stdin, line); err2 != nil {
			return fmt.Errorf("chat への書き込みに失敗: %w", err2)
		}
	}
	return nil
}

// shutdown closes the chat's stdin — the terminal's Ctrl-D: the boundary
// organs (Feedback は EOF で無信号 → 知覚) run in the body — and waits for the
// process. One that outlives the grace is killed, then reaped: the app must
// not hang on quit, and a Kill without the Wait would leak the child.
func (a *App) shutdown(_ context.Context) {
	a.mu.Lock()
	a.stopping = true
	p := a.proc
	a.proc = nil
	a.mu.Unlock()
	if p == nil {
		return
	}
	p.stdin.Close()
	select {
	case <-p.done:
	case <-time.After(chatShutdownGrace):
		p.cmd.Process.Kill()
		<-p.done
	}
}
