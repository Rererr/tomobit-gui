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
	Exists    bool            `json:"exists"`
	Stage     int             `json:"stage"`
	StageName string          `json:"stage_name"`
	Mood      *Mood           `json:"mood,omitempty"`
	Speak     string          `json:"speak,omitempty"`
	Providers []ProviderUsage `json:"providers,omitempty"`
	Growth    *Growth         `json:"growth,omitempty"`
}

// Growth は次の段への評価内訳(本体 ADR-0046 Decision 1)。旧本体はこの
// フィールドを知らないので nil になりうる — その場合ヘッダの開示UIごと
// 出さない(劣化は沈黙、decided と同じ扱い)。最上位(あいぼう)でも本体が
// フィールドごと省く(偽の100%を作らない)。
type Growth struct {
	Next     int          `json:"next"`
	NextName string       `json:"next_name"`
	Gates    []GrowthGate `json:"gates"`
}

// GrowthGate の Value は *float64: JSONのnullは「測定不能」(競争のある島が
// 無い等 — 本体 ADR-0045 Decision 1)で、0や未達と同じ顔にしてはならない
// (本体 ADR-0046)。Hint は本体が持つ「次の一手」翻訳表の出力 — GUI側で
// 再翻訳しない。
type GrowthGate struct {
	Name      string   `json:"name"`
	Value     *float64 `json:"value"`
	Threshold float64  `json:"threshold"`
	Met       bool     `json:"met"`
	Hint      string   `json:"hint,omitempty"`
}

// Mood is voice.Suggest の記号 — Marker は「!」「?」「z」等1文字で空文字もありうる。
type Mood struct {
	Name   string `json:"name"`
	Marker string `json:"marker"`
}

// ProviderUsage is one Provider の利用実績行(本体の同名View、cmd/tomobit/
// provider_usage.go)。集計は本体だけが担う(本体Decision 1) — ここは
// デコードするだけで、GUI側では一切再計算しない。
type ProviderUsage struct {
	Provider string  `json:"provider"`
	Runs     int     `json:"runs"`
	FirstTS  int64   `json:"first_ts"`
	LastTS   int64   `json:"last_ts"`
	Success  float64 `json:"success"`
	Scored   int     `json:"scored"`
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
