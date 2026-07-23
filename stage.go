// Tomo名ヘッダのステータスView (ADR-0001 Decision 5 / 本体 ADR-0039 Decision 3):
// `tomobit status --view json` をサブプロセス実行し、機械可読viewをそのまま
// TomoStatus へデコードする。台帳を書いているまさにそのバイナリが導出も担うため、
// 較正ノブ・Beta数学の移植(旧stage.go)と照合テストの追随義務はここで終わる。
package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

// TomoStatus is the header's View. Exists follows MemoryView's semantics:
// false means the ledger has never been created (the header shows a bare
// "Tomo" — 台帳が無いのに毛玉が居るとは言わない). Mood/Speak は本体
// voice.Suggest が黙れば省略されるフィールド(本体ADR-0039 Decision 1)なので
// ポインタ/ゼロ値許容とし、旧本体(このviewを知らない版)のデコードでも
// 前方互換契約(本体ADR-0032 Decision 1)を保つ。
type TomoStatus struct {
	Exists    bool   `json:"exists"`
	Stage     int    `json:"stage"`
	StageName string `json:"stage_name"`
	Mood      *Mood  `json:"mood,omitempty"`
	Speak     string `json:"speak,omitempty"`
}

// Mood is voice.Suggest の記号 — Marker は「!」「?」「z」等1文字で空文字もありうる。
type Mood struct {
	Name   string `json:"name"`
	Marker string `json:"marker"`
}

// GetTomoStatus asks the body for its own view of the ledger — the same
// open/close discipline as GetMemoryView (開いて読んで閉じる) but via the
// binary that writes the ledger, not a GUI-side re-derivation.
func (a *App) GetTomoStatus() (TomoStatus, error) {
	stdout, stderr, err := runTomobit("status", "--view", "json")
	if err != nil {
		msg := strings.TrimSpace(stderr)
		if msg == "" {
			msg = err.Error()
		}
		return TomoStatus{}, fmt.Errorf("tomobit status --view json の実行に失敗: %s", msg)
	}
	var status TomoStatus
	if err := json.Unmarshal([]byte(stdout), &status); err != nil {
		return TomoStatus{}, fmt.Errorf("tomobit status --view json の出力を解釈できない: %w", err)
	}
	return status, nil
}
