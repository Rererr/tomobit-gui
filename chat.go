// チャット配線 (ADR-0001 Decision 2): `tomobit chat` をパイプ接続の子プロセス
// として起動し、stdin へ 1行 = 1ターンを書き、stdout/stderr を届いた順の
// チャンクのままフロントエンドへ流す。ターン終端の機械可読なフレーミングは
// 存在しない（ADR-0001 が受け入れた摩擦）ので、構造は読まない — v1 は
// ストリーム表示で、入力は常時受け付ける。
package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// フロントエンドが購読するイベント名。
const (
	eventChatOut  = "chat:out"
	eventChatExit = "chat:exit"
)

// OutChunk is one piece of the chat stream, in arrival order.
type OutChunk struct {
	Channel string `json:"channel"` // "stdout" | "stderr"
	Text    string `json:"text"`
}

// ExitInfo reports the chat process ending. Error is "" on a clean exit.
type ExitInfo struct {
	Error string `json:"error"`
}

// chatProc is one running `tomobit chat`. done closes after Wait returns, so
// shutdown can bound its patience on it.
type chatProc struct {
	cmd   *exec.Cmd
	stdin io.WriteCloser
	done  chan struct{}
}

// chatShutdownGrace は閉窓時に子プロセスの区切り（Feedback の EOF → 知覚）を
// 待つ猶予。知覚は MLX で 2s/セッション程度だが、pending が溜まっていると
// 伸びるため一呼吸分を取る。超えたら Kill → Wait で確実に回収する。
const chatShutdownGrace = 15 * time.Second

// flattenTurnLine folds a multi-line draft into the pipe's one-line frame.
// 改行はスペースに潰す: 非TTYの chat は 1行 = 1ターンで、行継続の構文がない
// （lineedit の Shift+Enter は raw mode 専用）。素通しすると2行目以降が別ターン
// として別々に走ってしまうので、言葉を最小限だけ曲げる方を取る。本体側の
// cooked mode に継続構文が生えたら外す（クロスリポジトリ改修候補）。
func flattenTurnLine(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	return strings.ReplaceAll(s, "\n", " ")
}

// utf8CompletePrefix returns the length of b's longest prefix that does not
// end mid-rune. Only a trailing incomplete rune is held back; invalid bytes
// elsewhere pass through as-is — they were invalid in the stream too, and
// this is display plumbing, not validation.
func utf8CompletePrefix(b []byte) int {
	end := len(b)
	start := end - 1
	for start >= 0 && end-start <= utf8.UTFMax && !utf8.RuneStart(b[start]) {
		start--
	}
	if start < 0 || end-start > utf8.UTFMax {
		return end
	}
	if utf8.FullRune(b[start:end]) {
		return end
	}
	return start
}

// findTomobit looks on PATH first, then in ~/go/bin — a Finder-launched .app
// inherits the loginwindow PATH, which lacks the go install dir the CLI
// usually lives in.
func findTomobit(lookPath func(string) (string, error), userHome func() (string, error)) (string, error) {
	if p, err := lookPath("tomobit"); err == nil {
		return p, nil
	}
	if home, err := userHome(); err == nil {
		cand := filepath.Join(home, "go", "bin", "tomobit")
		if fi, err := os.Stat(cand); err == nil && !fi.IsDir() {
			return cand, nil
		}
	}
	return "", fmt.Errorf("tomobit が見つからない — 本体を `go install ./cmd/tomobit` して PATH か ~/go/bin に置くこと")
}

// ensureProcLocked spawns `tomobit chat` if none is running. Caller holds a.mu.
//
// 環境は素通しする（TOMOBIT_DB / TOMOBIT_CLAUDE_ARGS などの本体の env
// オーバーライドがそのまま効く）。TOMOBIT_FACE=1 は立てない — ADR-0001
// Decision 5 はそれを予定しているが、現行の本体は env より先に TTY ゲートで
// 顔窓起動を打ち切るため、pipe 起動では死に配線になる。本体側の改修と併せて
// 喋り方設定のタスクで入れる。
func (a *App) ensureProcLocked() error {
	if a.proc != nil {
		return nil
	}
	bin, err := findTomobit(exec.LookPath, os.UserHomeDir)
	if err != nil {
		return err
	}
	cmd := exec.Command(bin, "chat")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("chat の stdin 配管に失敗: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("chat の stdout 配管に失敗: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("chat の stderr 配管に失敗: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("tomobit chat の起動に失敗: %w", err)
	}
	p := &chatProc{cmd: cmd, stdin: stdin, done: make(chan struct{})}
	a.proc = p

	// Wait はパイプを閉じるので、両ストリームを飲み切ってから呼ぶ
	// (os/exec StdoutPipe の規約)。プロセスが死ねば EOF で必ず抜ける。
	var readers sync.WaitGroup
	readers.Add(2)
	go func() { defer readers.Done(); a.pumpStream(stdout, "stdout") }()
	go func() { defer readers.Done(); a.pumpStream(stderr, "stderr") }()
	go func() {
		readers.Wait()
		err := cmd.Wait()
		close(p.done)
		a.mu.Lock()
		if a.proc == p {
			a.proc = nil // 次の SendLine が再起動する
		}
		a.mu.Unlock()
		msg := ""
		if err != nil {
			msg = err.Error()
		}
		a.emitEvent(eventChatExit, ExitInfo{Error: msg})
	}()
	return nil
}

// pumpStream relays one pipe to the frontend in arrival-order chunks, cut at
// UTF-8 boundaries: a read that splits a multi-byte character carries the
// partial tail into the next chunk, because a broken rune inside a JSON
// string reaches the WebView as replacement characters.
func (a *App) pumpStream(r io.Reader, channel string) {
	buf := make([]byte, 4096)
	var carry []byte
	for {
		n, err := r.Read(buf)
		if n > 0 {
			carry = append(carry, buf[:n]...)
			cut := utf8CompletePrefix(carry)
			if cut > 0 {
				a.emitEvent(eventChatOut, OutChunk{Channel: channel, Text: string(carry[:cut])})
				carry = append(carry[:0], carry[cut:]...)
			}
		}
		if err != nil {
			if len(carry) > 0 {
				a.emitEvent(eventChatOut, OutChunk{Channel: channel, Text: string(carry)})
			}
			return
		}
	}
}
