// チャットの中からのコマンド実行 (ADR-0007)。モデルが書いた文字列を人が
// ワンクリックで走らせる経路なので、この1ファイルに枠を全部集める:
// 既定OFFのゲート・1本だけ・時間切れ・出力上限・標準入力を開けない。
package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
)

// runCommandTimeout はコマンド1本の上限 (ADR-0007 Decision 4)。人がボタンを押して
// 待つ長さとして選んでいる — これを超える仕事は端末で走らせる方が向いている。
const runCommandTimeout = 2 * time.Minute

// runCommandMaxOutput は stdout/stderr それぞれの保持上限 (ADR-0007 Decision 4)。
// 超えた分は捨てるが、捨てたことは CommandRun.Truncated で必ず言う。
const runCommandMaxOutput = 64 * 1024

// CommandRun is RunCommand's answer. 走ったかどうかと、何が起きたかを
// フロントへ返す。エラーで潰さないのは、「終了コード 1 で終わった」は失敗では
// なく結果だから — コマンドが落ちたことと、こちらが走らせられなかったことは別。
type CommandRun struct {
	// Command / WorkingDir は実際に走らせたもの。確認の帯に出した内容と
	// 同じであることを、結果の側からも確かめられるように返す。
	Command    string `json:"command"`
	WorkingDir string `json:"working_dir"`

	Stdout string `json:"stdout"`
	Stderr string `json:"stderr"`
	// ExitCode は終了コード。時間切れ・シグナル死など終了コードを名乗れない
	// 終わり方では -1 を返し、TimedOut / Stderr の側が理由を持つ。
	ExitCode int `json:"exit_code"`
	// TimedOut は runCommandTimeout を超えて殺したとき。
	TimedOut bool `json:"timed_out"`
	// Truncated は出力が上限を超えて切り詰められたとき。黙って切らないための旗。
	Truncated bool `json:"truncated"`
	// DurationMs は実際にかかった時間。
	DurationMs int64 `json:"duration_ms"`
}

// runningCommand は「同時に走るのは1本だけ」(ADR-0007 Decision 4) を守る錠。
// App の mu とは分ける — コマンドは分単位で走りうるので、その間チャットの
// 送信や設定保存まで止めるのは筋が違う。
var runningCommand sync.Mutex

// tryLockRunning は錠を取れたかどうかを返す。取れないときに待たないのは、
// 待たせると「押したのに何も起きない」時間が生まれ、人がもう一度押すため。
func tryLockRunning() bool {
	return runningCommand.TryLock()
}

// RunCommand runs one shell command from a chat code block (ADR-0007).
//
// 呼ばれる時点で、フロントは既に確認の帯を出して人の2度目のクリックを受けている
// (Decision 3)。ここはその最後の実行係で、確認そのものは持たない —— ただし
// **ゲートは持つ**: フロントの都合（古い画面・作り替え・バグ）で設定 OFF のまま
// 呼ばれても、ここで断る。押せるかどうかの判断を、画面だけに預けない。
func (a *App) RunCommand(command string) (CommandRun, error) {
	a.mu.Lock()
	cfg := a.guiConfig
	a.mu.Unlock()

	if !cfg.RunCommandEnabled() {
		// 設定が OFF のときは走らせない。ボタンが出ていないはずの状態なので、
		// 人向けの言い訳ではなく、経路が食い違っていることを名指しで返す。
		return CommandRun{}, errors.New("コマンド実行は設定で無効になっている（設定 → チャットからコマンドを実行する）")
	}
	if strings.TrimSpace(command) == "" {
		return CommandRun{}, errors.New("空のコマンドは走らせない")
	}
	if !tryLockRunning() {
		return CommandRun{}, errors.New("別のコマンドがまだ走っている")
	}
	defer runningCommand.Unlock()

	// cwd は作業ディレクトリ (ADR-0004 Decision 1)。未設定なら "" のまま渡し、
	// exec に GUI プロセスの cwd を継承させる — チャット子プロセスと同じ規律で、
	// GUI が独自の既定location を発明しない。
	workDir := cfg.WorkingDir

	ctx, cancel := context.WithTimeout(context.Background(), runCommandTimeout)
	defer cancel()

	// sh -c: パイプ・リダイレクトを通すため (ADR-0007 Decision 4)。argv 分割は
	// 安全を買わないのに使えるコマンドだけを減らす、と ADR で退けている。
	cmd := exec.CommandContext(ctx, "sh", "-c", command)
	cmd.Dir = workDir
	cmd.Env = a.chatEnv()

	// 標準入力は即 EOF。対話を想定しない (Decision 4) —— 開けたままにすると、
	// 入力を待つコマンドがタイムアウトまで黙って居座る。
	cmd.Stdin = strings.NewReader("")

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// 子プロセスを独立したプロセスグループに置く。パイプラインの途中で立った孫
	// （`foo | bar` の bar、バックグラウンドに逃げた子）まで、時間切れのときに
	// まとめて殺せるようにするため — sh だけ殺しても孫は生き残る。
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	started := time.Now()
	err := cmd.Start()
	if err != nil {
		return CommandRun{}, fmt.Errorf("起動できなかった: %w", err)
	}
	pgid := cmd.Process.Pid

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	var timedOut bool
	select {
	case err = <-done:
	case <-ctx.Done():
		timedOut = true
		// プロセスグループごと。負の pid が「グループへ」の意味 (kill(2))。
		_ = syscall.Kill(-pgid, syscall.SIGKILL)
		err = <-done
	}

	run := CommandRun{
		Command:    command,
		WorkingDir: workDir,
		ExitCode:   exitCodeOf(err, timedOut),
		TimedOut:   timedOut,
		DurationMs: time.Since(started).Milliseconds(),
	}
	var cut bool
	run.Stdout, cut = truncateOutput(stdout.String(), runCommandMaxOutput)
	run.Truncated = cut
	run.Stderr, cut = truncateOutput(stderr.String(), runCommandMaxOutput)
	run.Truncated = run.Truncated || cut

	// 走らせられた以上、コマンド自身の失敗は error にしない — 終了コード 1 は
	// 「こちらが失敗した」ではなく「そういう結果だった」。error を返すと画面は
	// 出力を捨てて赤い一行になり、人が一番読みたい stderr が消える。
	return run, nil
}

// exitCodeOf は cmd.Wait のエラーから終了コードを取り出す。名乗れない終わり方
// （時間切れ・シグナル死・そもそも起動していない）は -1 で、理由は呼び出し側の
// TimedOut / Stderr が持つ。0 を返して「正常終了」に見せることだけはしない。
func exitCodeOf(waitErr error, timedOut bool) int {
	if timedOut {
		return -1
	}
	if waitErr == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(waitErr, &exitErr) {
		if code := exitErr.ExitCode(); code >= 0 {
			return code
		}
	}
	return -1
}

// truncateOutput は上限を超えた出力を先頭側で切り、切ったかどうかを返す
// (ADR-0007 Decision 4: 黙って切り詰めない)。残すのは末尾 —— コマンドの出力は
// 最後の行（結果・エラー）が一番読まれるため。バイト境界で切ると UTF-8 の
// 途中で割れるので、切った位置から最初の有効な先頭バイトまで進める。
func truncateOutput(s string, limit int) (string, bool) {
	if len(s) <= limit {
		return s, false
	}
	b := []byte(s)
	tail := b[len(b)-limit:]
	for len(tail) > 0 && tail[0]&0xc0 == 0x80 {
		tail = tail[1:]
	}
	return string(tail), true
}
