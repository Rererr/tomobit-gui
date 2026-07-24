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

	// taskOpen tracks whether a task is currently open in this chat, read from
	// the view stream's task.started / task.finished|cancelled (本体 ADR-0032
	// の契約)。働く場所の宣言を送ってよい瞬間の判定にだけ使う: タスクの途中で
	// 送っても本体は「/new で区切ってから」と断り、宣言の行数だけ断り文句が
	// 会話面に並ぶ（実機で確認）。境界の規律そのものは本体が持ったままで、
	// GUI はここで「開いているか」という観測事実だけを見る。
	taskMu   sync.Mutex
	taskOpen bool
}

func (p *chatProc) setTaskOpen(v bool) {
	p.taskMu.Lock()
	p.taskOpen = v
	p.taskMu.Unlock()
}

func (p *chatProc) isTaskOpen() bool {
	p.taskMu.Lock()
	defer p.taskMu.Unlock()
	return p.taskOpen
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

// quoteArgToken double-quotes s for the body's TOMOBIT_CLAUDE_ARGS_APPEND
// parser (ADR-0001 追記): \ and " become \\ and \" so the value survives as one
// double-quoted token even when the speaking style — or a directory path
// (ADR-0004 Decision 2) — holds spaces or quotes.
func quoteArgToken(s string) string {
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
//
// 読み取り先はここを通らない (ADR-0004 改訂 / 本体 ADR-0047): この env は
// claude アダプタ専用の口で、codex を選んだ人には無言で効かなくなる。
// 働く場所は本体の Request の一級市民になったので、GUI は /add-dir で渡す。
func composeClaudeArgsAppend(existing, speakingStyle string) string {
	arg := "--append-system-prompt " + quoteArgToken(speakingStyle)
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

// workspaceDeclaration is what the GUI tells a running chat about the places
// Tomo works (本体 ADR-0047 Decision 4 の /cd・/add-dir)。宣言は全置換で組む:
// GUI は一覧まるごとを持っているので、差分を送るより「消してから並べ直す」
// 方が画面と本体のズレようがない。
//
// 作業ディレクトリを未設定へ戻す宣言は無い（/cd に「起動時の場所へ戻れ」の
// 語彙が無い）— そのときは /cd を送らず、次のプロセス起動で継承に戻る。
func workspaceDeclaration(workingDir string, readDirs []string) string {
	var b strings.Builder
	if workingDir != "" {
		b.WriteString("/cd " + workingDir + "\n")
	}
	b.WriteString("/add-dir clear\n")
	for _, dir := range readDirs {
		b.WriteString("/add-dir " + dir + "\n")
	}
	return b.String()
}

// splitExistingDirs partitions dirs into the ones that are still directories
// and the ones that are not (ADR-0004 Decision 5). stat を引数に取るのは
// テストのため — 実体は os.Stat。
func splitExistingDirs(dirs []string, stat func(string) (os.FileInfo, error)) (existing, missing []string) {
	for _, dir := range dirs {
		if fi, err := stat(dir); err == nil && fi.IsDir() {
			existing = append(existing, dir)
			continue
		}
		missing = append(missing, dir)
	}
	return existing, missing
}

// checkWorkingDir fails with a named error when the configured working dir is
// gone (ADR-0004 Decision 1): exec が cmd.Dir の不在で返す chdir エラーは
// 人にはどの設定が悪いのか読めない。空（未設定）は継承なので何も言わない。
func checkWorkingDir(dir string, stat func(string) (os.FileInfo, error)) error {
	if dir == "" {
		return nil
	}
	fi, err := stat(dir)
	if err != nil {
		return fmt.Errorf("作業ディレクトリが見つからない: %s — チャット下部のバーで選び直すこと (%w)", dir, err)
	}
	if !fi.IsDir() {
		return fmt.Errorf("作業ディレクトリがディレクトリではない: %s — チャット下部のバーで選び直すこと", dir)
	}
	return nil
}

// composeChatArgs builds the child chat's argv (本体 ADR-0043 Decision 5)。
// composeChatEnv と同じ「合成は純関数へ切り出す」パターン。--provider は
// 常に明示で積む: 未設定を無指定で流すと本体の既定に黙って乗ることになり、
// 既定が変わったとき GUI の挙動が無言で変わる — Decision 5 が塞ぐ不正直さ
// そのもの。未設定の解決（=auto）は GUIConfig.ChatProvider が持つ。
// 働く場所も起動時は argv で渡す (本体 ADR-0047 Decision 6): 起動直後に
// /cd・/add-dir を送る形だと、本体の応答（"add-dir: …"）が人の最初の一言より
// 先にチャット面へ並ぶ — 会話の器が配線の独り言で始まってしまう。
func composeChatArgs(provider, workingDir string, readDirs []string) []string {
	args := []string{"chat", "--view", "ndjson", "--provider", provider}
	if workingDir != "" {
		args = append(args, "--cd", workingDir)
	}
	for _, dir := range readDirs {
		args = append(args, "--add-dir", dir)
	}
	return args
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

// newChatCmd assembles the chat child: argv（Provider 選択 — 本体 ADR-0043
// Decision 5 / 働く場所 — 本体 ADR-0047 Decision 6）と env（喋り方 ADR-0001
// Decision 4 / 顔窓 本体 ADR-0032 Decision 3）。GUI 自身は chdir しない: 働く
// 場所は --cd で子プロセスにだけ渡り、顔窓や status/forget など他の子プロセスへ
// 副作用を撒かない。Caller holds a.mu.
func (a *App) newChatCmd(bin string, readDirs []string) *exec.Cmd {
	cmd := exec.Command(bin, composeChatArgs(a.guiConfig.ChatProvider(), a.guiConfig.WorkingDir, readDirs)...)
	cmd.Env = a.chatEnv()
	return cmd
}

// ensureProcLocked spawns `tomobit chat --view ndjson --provider <choice>`
// if none is running (provider は gui.json の選択、未設定は auto — 本体
// ADR-0043 Decision 5)。
// Caller holds a.mu. view ストリームで stdout が全量 NDJSON になり、ターン終端が
// 機械可読になる（本体 ADR-0032 Decision 1）。顔窓のオプトイン（TOMOBIT_FACE=1）は
// 同 Decision 3 で pipe 起動でも効くようになった — env 合成は composeChatEnv に
// 切り出す。
func (a *App) ensureProcLocked() error {
	if a.proc != nil {
		return nil
	}
	// 設定の誤りはバイナリ探索より先に判じる: 作業ディレクトリの不在は起動を
	// 止める (ADR-0004 Decision 1) — 立つ場所が無いまま起動して exec の生の
	// chdir エラーを見せない。
	if err := checkWorkingDir(a.guiConfig.WorkingDir, os.Stat); err != nil {
		return err
	}
	bin, err := findTomobit(exec.LookPath, os.UserHomeDir)
	if err != nil {
		return err
	}
	// 読み取り先の不在は劣化に留める (同 Decision 5): 落として、後で言う。
	readDirs, missingDirs := splitExistingDirs(a.guiConfig.NormalizedReadDirs(), os.Stat)
	cmd := a.newChatCmd(bin, readDirs)
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
	sb, sbDiag := a.newScrollbackWriter()
	go func() { defer readers.Done(); a.pumpViewStream(stdout, sb) }()
	go func() { defer readers.Done(); a.pumpStream(stderr, "stderr") }()
	a.reportStartupDiagnostics(missingDirsDiagnostic(missingDirs), sbDiag)
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
func (a *App) pumpViewStream(r io.Reader, sb *scrollbackWriter) {
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
				if sb != nil {
					sb.record(carry[:i])
				}
				a.emitViewLine(carry[:i])
				carry = append(carry[:0], carry[i+1:]...)
			}
		}
		if err != nil {
			if len(carry) > 0 {
				if sb != nil {
					sb.record(carry)
				}
				a.emitViewLine(carry)
			}
			if sb != nil {
				sb.close()
			}
			return
		}
	}
}

// newScrollbackWriter builds the per-session scrollback writer, but only past
// the consent gate (ADR-0003 Decision 0): guiConfig.TranscriptCacheEnabled が
// false なら nil を返し、pumpViewStream は 1 バイトも書かない。Caller は
// ensureProcLocked で a.mu を保持しているため a.guiConfig の読みは安全。
// 書き込み診断はチャットを止めず、既存の chat:out stderr 経路へ1行流す —
// ただし発火は呼び出し側 (reportStartupDiagnostics) に返す: a.mu を保持した
// ままの emitEvent は同じ mutex を取り直してデッドロックする。
func (a *App) newScrollbackWriter() (*scrollbackWriter, string) {
	if !a.guiConfig.TranscriptCacheEnabled() {
		return nil, ""
	}
	dir, err := scrollbackDir()
	if err != nil {
		return nil, "gui-scrollback: 保存先の解決に失敗: " + err.Error()
	}
	return &scrollbackWriter{
		dir:   dir,
		limit: scrollbackTotalLimit,
		onErr: func(msg string) {
			a.emitEvent(eventChatOut, OutChunk{Channel: "stderr", Text: msg + "\n"})
		},
		// 各行で現在の同意状態を再照合する (W-1): SaveGUIConfig が走行中に OFF へ
		// 撤回したら、このセッションの以後の書き込みも即座に止まる。a.guiConfig は
		// SaveGUIConfig が a.mu 下で差し替えるので、読みも a.mu で保護する。
		enabled: func() bool {
			a.mu.Lock()
			defer a.mu.Unlock()
			return a.guiConfig.TranscriptCacheEnabled()
		},
	}, ""
}

// missingDirsDiagnostic wording for read dirs dropped at launch (ADR-0004
// Decision 5). 空のときは空文字 — 何も落ちていないなら何も言わない。
func missingDirsDiagnostic(missing []string) string {
	if len(missing) == 0 {
		return ""
	}
	return "読み取り先が見つからないため外した: " + strings.Join(missing, ", ")
}

// reportStartupDiagnostics streams the launch-time notes (dropped read dirs,
// scrollback wiring) to the stderr 面. 別 goroutine で流すのは a.mu のため:
// 呼び出し元の ensureProcLocked はロックを保持しており、emitEvent は同じ
// mutex を取る。空文字は「言うことが無い」なので落とす。
func (a *App) reportStartupDiagnostics(notes ...string) {
	var lines []string
	for _, note := range notes {
		if note != "" {
			lines = append(lines, note)
		}
	}
	if len(lines) == 0 {
		return
	}
	go func() {
		for _, line := range lines {
			a.emitEvent(eventChatOut, OutChunk{Channel: "stderr", Text: line + "\n"})
		}
	}()
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
	a.trackTaskBoundary(ev)
	a.emitEvent(eventChatView, ev)
}

// trackTaskBoundary follows task.started / task.finished|cancelled so
// SetWorkspace knows whether a task is open (see chatProc.taskOpen). 未知の
// type は無視する — 契約どおり (本体 ADR-0032)。
func (a *App) trackTaskBoundary(ev map[string]any) {
	typ, _ := ev["type"].(string)
	var open bool
	switch typ {
	case "task.started":
		open = true
	case "task.finished", "task.cancelled":
		open = false
	default:
		return
	}
	a.mu.Lock()
	p := a.proc
	a.mu.Unlock()
	if p != nil {
		p.setTaskOpen(open)
	}
}
