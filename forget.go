// 忘却の器官の口 (本体ADR-0033 Decision 6): メモリViewの書き込みは本体CLIの
// `tomobit forget` / `tomobit amend` をサブプロセス実行で呼ぶ。GUIはDBに
// 書かない — 読みは mode=ro (memory.go)、書きはこの2動詞のみ。不可逆操作の
// 確認ゲートは画面側 (MemoryPane の二段確認) が担い、非TTYで必須の --yes を
// 付けて呼ぶ (Decision 2)。JSONやproviderの検証はCLIが唯一の検証者 —
// GUIで再実装すると本体の閉集合 (context key / provider名) とドリフトする。
package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// forgetTimeout bounds one CLI run. forget/amend は同一コマンド内で
// rebuild+VACUUM まで走る (ADR-0033) ので数秒のオーダーだが、ロック競合等で
// 固まったときにUIを道連れにしない上限。
const forgetTimeout = 2 * time.Minute

// runTomobit runs one body verb to completion and returns both streams.
// A package var, not a method, so tests can swap in a capture without a
// real binary (App.emit と同じ動機の注入点)。
var runTomobit = runTomobitSubprocess

func runTomobitSubprocess(args ...string) (stdout, stderr string, err error) {
	bin, err := findTomobit(exec.LookPath, os.UserHomeDir)
	if err != nil {
		return "", "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), forgetTimeout)
	defer cancel()
	// 環境は素通し (chat.go と同じ姿勢): TOMOBIT_DB 等の env オーバーライドが
	// 読み (dbPath) と書き (CLI) で同じ台帳を指す。
	cmd := exec.CommandContext(ctx, bin, args...)
	var outBuf, errBuf bytes.Buffer
	cmd.Stdout, cmd.Stderr = &outBuf, &errBuf
	err = cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		err = fmt.Errorf("tomobit %s が %s 以内に終わらない", args[0], forgetTimeout)
	}
	return outBuf.String(), errBuf.String(), err
}

// WriteResult is one forget/amend run's outcome: the body's one-line stdout
// summary (ADR-0033 Decision 6 の契約) と、成功時に stderr へ届いた通知
// (例: forget --session の子セッション列挙。--id 経路では通常空)。
type WriteResult struct {
	Summary string `json:"summary"`
	Notice  string `json:"notice"`
}

// AmendRequest carries one experience correction. Set* が「この項目を置き換える」
// を「触らない」から言い分ける — CLIの「フラグ省略 = 保持」に対応し、
// 空文字だけでは区別できない。
type AmendRequest struct {
	ID          string `json:"id"`
	SetContext  bool   `json:"set_context"`
	Context     string `json:"context"` // JSONオブジェクト文字列 (全置換)
	SetOutcome  bool   `json:"set_outcome"`
	Outcome     string `json:"outcome"` // JSON文字列 (全置換)
	SetProvider bool   `json:"set_provider"`
	Provider    string `json:"provider"`
}

// ForgetExperiences physically deletes the named experiences via
// `tomobit forget --id ... --yes` (rebuild+VACUUMまで本体が同一コマンドで行う)。
func (a *App) ForgetExperiences(ids []string) (WriteResult, error) {
	if len(ids) == 0 {
		return WriteResult{}, fmt.Errorf("forget: 対象の経験idが無い")
	}
	args := []string{"forget"}
	for _, id := range ids {
		if strings.TrimSpace(id) == "" {
			return WriteResult{}, fmt.Errorf("forget: 空の経験idが混ざっている")
		}
		args = append(args, "--id", id)
	}
	args = append(args, "--yes")
	return runWriteVerb(args)
}

// AmendExperience corrects one experience via `tomobit amend` — 削除ではなく
// 人間による再知覚の追記 (ADR-0033 Decision 3)。変更しない項目はフラグごと
// 省略し、本体の「省略 = 保持」に乗せる。
func (a *App) AmendExperience(req AmendRequest) (WriteResult, error) {
	if strings.TrimSpace(req.ID) == "" {
		return WriteResult{}, fmt.Errorf("amend: 経験idが無い")
	}
	if !req.SetContext && !req.SetOutcome && !req.SetProvider {
		return WriteResult{}, fmt.Errorf("amend: 変更が無い — context / outcome / provider のいずれかを編集すること")
	}
	args := []string{"amend", "--id", req.ID}
	if req.SetContext {
		args = append(args, "--context", req.Context)
	}
	if req.SetOutcome {
		args = append(args, "--outcome", req.Outcome)
	}
	if req.SetProvider {
		args = append(args, "--provider", req.Provider)
	}
	return runWriteVerb(args)
}

// runWriteVerb runs one write verb and maps the CLI contract into a result:
// 成功 = stdout の1行サマリ + stderr の通知。失敗 = stderr のエラー文言を
// そのままユーザーへ (本体の検証メッセージが許容値の一覧まで含む)。
// VACUUM失敗 (ADR-0033 Decision 5) はサマリ出力後にエラー終了するので、
// 済んだ事実を握り潰さず両方運ぶ。
func runWriteVerb(args []string) (WriteResult, error) {
	stdout, stderr, err := runTomobit(args...)
	summary := strings.TrimSpace(stdout)
	if err != nil {
		msg := strings.TrimSpace(stderr)
		if msg == "" {
			msg = err.Error()
		}
		if summary != "" {
			return WriteResult{}, fmt.Errorf("%s（完了済み: %s）", msg, summary)
		}
		return WriteResult{}, fmt.Errorf("%s", msg)
	}
	return WriteResult{Summary: summary, Notice: strings.TrimSpace(stderr)}, nil
}
