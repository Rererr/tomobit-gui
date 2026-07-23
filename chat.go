// チャット配線 (ADR-0001 Decision 2 / 本体 ADR-0032): `tomobit chat --view ndjson`
// をパイプ接続の子プロセスとして起動する。stdout は契約上 全量 NDJSON の view
// ストリーム（1行 = 1 view イベント）なので、行にフレーミングして JSON デコード
// し chat:view として流す。stderr は契約外の人間向け診断なので、従来どおり届いた
// 順のチャンクのまま chat:out へ流す。stdin へはターンを書く（複数行入力は末尾
// `\` 継続でエンコードする — 本体 lineedit readCooked と同じ意味論）。
package main

import (
	"bytes"
	"encoding/json"
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
	eventChatOut  = "chat:out"  // stderr（契約外の人間向け診断）のチャンク中継
	eventChatView = "chat:view" // stdout の NDJSON view イベント（1件 = 1行）
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
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	done    chan struct{}
	writeMu sync.Mutex // serializes write calls; deliberately not a.mu (see write)
}

// write serializes this proc's stdin writes against other write calls on the
// same proc (e.g. a SendLine racing an EndTask), so a multi-line turn can't
// interleave with another caller's bytes in the child's pipe. It holds only
// writeMu, never a.mu: the child may be mid-turn and not reading stdin, so
// this can block on a full pipe buffer, and shutdown must be able to close
// stdin — which the Go runtime's poller-integrated I/O unblocks a pending
// write with an error — without waiting behind app-state lock holders.
func (p *chatProc) write(s string) error {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	_, err := io.WriteString(p.stdin, s)
	return err
}

// chatShutdownGrace は閉窓時に子プロセスの区切り（Feedback の EOF → 知覚）を
// 待つ猶予。知覚は MLX で 2s/セッション程度だが、pending が溜まっていると
// 伸びるため一呼吸分を取る。超えたら Kill → Wait で確実に回収する。
const chatShutdownGrace = 15 * time.Second

// encodeTurn writes a possibly multi-line draft as the pipe's line-continuation
// wire form (本体 ADR-0032 Decision 2), the encoder side of lineedit readCooked —
// 末尾 `\` の行は「まだ終わりではない」。意味論を reader に正確に合わせる:
//
//   - \r\n / \r を \n に正規化して行に分割
//   - 最終行以外: 各行の末尾に `\` を1つ足す（元々 `\` で終わっていても reader は
//     1つだけ剥ぐので内容は保存される）
//   - 最終行が `\` で終わらない: そのまま + 改行で閉じる
//   - 最終行が `\` で終わる: `\` を1つ足して書き、続けて空行で閉じる（reader 側で
//     末尾に改行が1つ付くのは raw mode で同じ操作をした結果と同一 — ADR-0032 が
//     明記する許容）
//   - 空文字列は素の空行 "\n"（境界 Feedback への「まだ言えない」回答経路）
//
// 改行をスペースへ潰していた旧 flattenTurnLine の置き換え: 言葉を曲げず、本体の
// 継続構文にそのまま乗せる。
func encodeTurn(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	lines := strings.Split(s, "\n")
	var b strings.Builder
	for i, line := range lines {
		if i < len(lines)-1 {
			b.WriteString(line)
			b.WriteString("\\\n")
			continue
		}
		if strings.HasSuffix(line, "\\") {
			b.WriteString(line)
			b.WriteString("\\\n\n")
			continue
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	return b.String()
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

// escapeAppendSystemPrompt double-quotes s for the body's TOMOBIT_CLAUDE_ARGS_APPEND
// parser (ADR-0001 追記): \ and " become \\ and \" so the value survives as one
// double-quoted token even when the speaking style holds spaces or quotes.
func escapeAppendSystemPrompt(s string) string {
	var b strings.Builder
	b.Grow(len(s) + 2)
	b.WriteByte('"')
	for _, r := range s {
		if r == '\\' || r == '"' {
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	b.WriteByte('"')
	return b.String()
}

// composeClaudeArgsAppend builds the value for env TOMOBIT_CLAUDE_ARGS_APPEND
// (ADR-0001 追記): the speaking style becomes a trailing --append-system-prompt,
// appended after whatever the parent process env already carries so an
// existing append survives instead of being clobbered.
func composeClaudeArgsAppend(existing, speakingStyle string) string {
	arg := "--append-system-prompt " + escapeAppendSystemPrompt(speakingStyle)
	if existing == "" {
		return arg
	}
	return existing + " " + arg
}

// composeChatEnv builds the child chat process's environment (ADR-0001
// Decision 4/5 / 本体 ADR-0032 Decision 3). base は親環境の素通し（TOMOBIT_DB
// などの本体の env オーバーライドをそのまま効かせる）。喋り方の注入と顔窓の
// オプトインは互いに独立で、両方該当すれば直積で両方積まれる。
//
// faceSet が真（親が TOMOBIT_FACE を明示している）なら顔窓の env には触らない —
// ユーザーの明示した =0 を GUI が黙って =1 で覆すのは env>config の序列に反する。
// faceSet が偽のときだけ GUI 設定 faceEnabled（既定 ON）を見る: ON なら
// 「この pipe の先に人が居る」と=1を立て（ADR-0032 Decision 3）、GUI設定で
// OFF にした場合は何も書かず沈黙のままにする — 本体の「env沈黙時の既定は
// TTYゲート」により pipe 起動では沈黙=開かないので、OFFの意思は `=0` を書く
// のでなく黙ることで表す。
func composeChatEnv(base []string, speakingStyle string, faceSet bool, existingAppend string, faceEnabled bool) []string {
	env := base
	if style := strings.TrimSpace(speakingStyle); style != "" {
		env = append(env, "TOMOBIT_CLAUDE_ARGS_APPEND="+composeClaudeArgsAppend(existingAppend, style))
	}
	if !faceSet && faceEnabled {
		env = append(env, "TOMOBIT_FACE=1")
	}
	return env
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

// chatEnv is the wiring point between the process environment / a.guiConfig
// and composeChatEnv's pure合成: composeChatEnv自体のユニットテストは
// os.Environ()・a.guiConfigの参照を経由しないため、引数の取り違えは
// ここでしか踏めない。
func (a *App) chatEnv() []string {
	// os.Environ() に同キーが残っていても exec.Cmd が重複キーを後勝ちで dedupe する
	// ので、合成済みの値が子へ届く（既存値が引用符不整合だと合成分がその中に呑まれる
	// が、それは env を手で壊した場合だけ — GUI 自身の合成出力は常に整形式）。
	_, faceSet := os.LookupEnv("TOMOBIT_FACE")
	existing := os.Getenv("TOMOBIT_CLAUDE_ARGS_APPEND")
	return composeChatEnv(os.Environ(), a.guiConfig.SpeakingStyle, faceSet, existing, a.guiConfig.FaceWindowEnabled())
}

// ensureProcLocked spawns `tomobit chat --view ndjson` if none is running.
// Caller holds a.mu. view ストリームで stdout が全量 NDJSON になり、ターン終端が
// 機械可読になる（本体 ADR-0032 Decision 1）。顔窓のオプトイン（TOMOBIT_FACE=1）は
// 同 Decision 3 で pipe 起動でも効くようになった — env 合成は composeChatEnv に
// 切り出す。
func (a *App) ensureProcLocked() error {
	if a.proc != nil {
		return nil
	}
	bin, err := findTomobit(exec.LookPath, os.UserHomeDir)
	if err != nil {
		return err
	}
	cmd := exec.Command(bin, "chat", "--view", "ndjson")
	// 喋り方 (ADR-0001 Decision 4) と顔窓 (ADR-0032 Decision 3) を子 env に積む。
	cmd.Env = a.chatEnv()
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
	go func() { defer readers.Done(); a.pumpViewStream(stdout) }()
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

// pumpViewStream frames stdout into NDJSON view events (本体 ADR-0032 Decision 1).
// stdout は契約上 全量 NDJSON なので、読み取りチャンクが行の途中で切れても持ち越し
// て完全な1行を組み、行ごとに emitViewLine へ渡す。EOF 時に持ち越しが残っていれば
// 同様に処理する。UTF-8 境界の面倒は要らない — 行は JSON デコードするか丸ごと文字
// 列化するかで、いずれも完全な行の全バイトを一度に扱う。
func (a *App) pumpViewStream(r io.Reader) {
	buf := make([]byte, 4096)
	var carry []byte
	for {
		n, err := r.Read(buf)
		if n > 0 {
			carry = append(carry, buf[:n]...)
			for {
				i := bytes.IndexByte(carry, '\n')
				if i < 0 {
					break
				}
				a.emitViewLine(carry[:i])
				carry = append(carry[:0], carry[i+1:]...)
			}
		}
		if err != nil {
			if len(carry) > 0 {
				a.emitViewLine(carry)
			}
			return
		}
	}
}

// emitViewLine decodes one NDJSON line and emits it as a chat:view event
// (本体 ADR-0032 Decision 1). Go は type を解釈せず map をそのまま素通しする —
// 未知 type の無視は消費者=フロントエンドの責務。JSON デコードに失敗した行は
// 握り潰さず note にフォールバックする: stdout は契約上 全量 NDJSON なので、
// 非JSON行は本体のバグであり、可視化して黙らせない。
func (a *App) emitViewLine(line []byte) {
	line = bytes.TrimSuffix(line, []byte("\r"))
	if len(line) == 0 {
		return
	}
	var ev map[string]any
	if err := json.Unmarshal(line, &ev); err != nil {
		a.emitEvent(eventChatView, map[string]any{"type": "note", "text": string(line)})
		return
	}
	a.emitEvent(eventChatView, ev)
}
