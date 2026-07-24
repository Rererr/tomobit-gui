package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// withFakeTomobit puts an executable "tomobit" at the front of PATH for the
// duration of one test, echoing script's stdout/stderr/exit code — exercises
// the real findTomobit → exec.Command 経路 (runTomobit のモック差し替えでは
// サブプロセス起動そのものは検証できない)。実DB・実バイナリは要らない。
func withFakeTomobit(t *testing.T, script string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "tomobit")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+script+"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func TestGetTomoStatus_台帳ありは本体viewのstageをそのままデコードする(t *testing.T) {
	withFakeTomobit(t, `echo '{"type":"status","exists":true,"stage":4,"stage_name":"おとな","mood":{"name":"ふつう","marker":""},"speak":"やあ"}'`)
	status, err := NewApp().GetTomoStatus()
	if err != nil {
		t.Fatal(err)
	}
	if !status.Exists || status.Stage != 4 || status.StageName != "おとな" {
		t.Errorf("status = %+v, want exists=true stage=4 おとな", status)
	}
}

func TestGetTomoStatus_speak欠落は空文字にデコードされる(t *testing.T) {
	// voice.Suggest が黙るとフィールドごと欠落する(本体ADR-0039 Decision 1)。
	withFakeTomobit(t, `echo '{"type":"status","exists":true,"stage":4,"stage_name":"おとな","mood":{"name":"ふつう","marker":""}}'`)
	status, err := NewApp().GetTomoStatus()
	if err != nil {
		t.Fatal(err)
	}
	if status.Speak != "" {
		t.Errorf("status.Speak = %q, want 空文字", status.Speak)
	}
	if status.Mood == nil || status.Mood.Marker != "" {
		t.Errorf("status.Mood = %+v, want marker 空文字のMood", status.Mood)
	}
}

func TestGetTomoStatus_moodのmarker空文字はそのままデコードされる(t *testing.T) {
	withFakeTomobit(t, `echo '{"type":"status","exists":true,"stage":1,"stage_name":"あかご","mood":{"name":"ふつう","marker":""},"speak":"やあ"}'`)
	status, err := NewApp().GetTomoStatus()
	if err != nil {
		t.Fatal(err)
	}
	if status.Mood == nil || status.Mood.Name != "ふつう" || status.Mood.Marker != "" {
		t.Errorf("status.Mood = %+v, want {ふつう }", status.Mood)
	}
}

func TestGetTomoStatus_旧本体形式はmood無しspeak無しでもデコードできる(t *testing.T) {
	// mood/speak を知らない旧本体(本体ADR-0039以前)の出力を模す。
	withFakeTomobit(t, `echo '{"type":"status","exists":true,"stage":2,"stage_name":"こども"}'`)
	status, err := NewApp().GetTomoStatus()
	if err != nil {
		t.Fatal(err)
	}
	if status.Mood != nil {
		t.Errorf("status.Mood = %+v, want nil", status.Mood)
	}
	if status.Speak != "" {
		t.Errorf("status.Speak = %q, want 空文字", status.Speak)
	}
}

func TestGetTomoStatus_台帳なしはExistsFalseのゼロ値(t *testing.T) {
	withFakeTomobit(t, `echo '{"type":"status","exists":false}'`)
	status, err := NewApp().GetTomoStatus()
	if err != nil {
		t.Fatal(err)
	}
	if status.Exists || status.Stage != 0 || status.StageName != "" {
		t.Errorf("status = %+v, want zero value", status)
	}
}

func TestGetTomoStatus_未知フィールドは無視して既知フィールドだけ読む(t *testing.T) {
	withFakeTomobit(t, `echo '{"type":"status","exists":true,"stage":2,"stage_name":"こども","future_field":{"nested":true}}'`)
	status, err := NewApp().GetTomoStatus()
	if err != nil {
		t.Fatal(err)
	}
	if !status.Exists || status.Stage != 2 || status.StageName != "こども" {
		t.Errorf("status = %+v, want exists=true stage=2 こども", status)
	}
}

func TestGetTomoStatus_providersフィールドをそのままデコードする(t *testing.T) {
	withFakeTomobit(t, `echo '{"type":"status","exists":true,"stage":4,"stage_name":"おとな","providers":[{"provider":"claude-code","runs":41,"first_ts":1000,"last_ts":2000,"success":0.9,"scored":41}]}'`)
	status, err := NewApp().GetTomoStatus()
	if err != nil {
		t.Fatal(err)
	}
	if len(status.Providers) != 1 {
		t.Fatalf("providers = %+v, want 1 row", status.Providers)
	}
	got := status.Providers[0]
	if got.Provider != "claude-code" || got.Runs != 41 || got.Success != 0.9 || got.Scored != 41 {
		t.Errorf("providers[0] = %+v, want provider=claude-code runs=41 success=0.9 scored=41", got)
	}
}

func TestGetTomoStatus_providers欠落はnilにデコードされる(t *testing.T) {
	// 旧本体(このフィールドを知らない版)・利用実績が無いケース(本体omitempty)の両方を模す。
	withFakeTomobit(t, `echo '{"type":"status","exists":true,"stage":2,"stage_name":"こども"}'`)
	status, err := NewApp().GetTomoStatus()
	if err != nil {
		t.Fatal(err)
	}
	if status.Providers != nil {
		t.Errorf("status.Providers = %+v, want nil", status.Providers)
	}
}

func TestGetTomoStatus_growthフィールドをそのままデコードする(t *testing.T) {
	withFakeTomobit(t, `echo '{"type":"status","exists":true,"stage":3,"stage_name":"わかもの","growth":{"next":4,"next_name":"おとな","gates":[{"name":"evidence","value":22.1,"threshold":3,"met":true},{"name":"sharpness","value":0.49,"threshold":0.2,"met":false,"hint":"duelや質問に答えて好みを教える"}]}}'`)
	status, err := NewApp().GetTomoStatus()
	if err != nil {
		t.Fatal(err)
	}
	if status.Growth == nil {
		t.Fatal("status.Growth = nil, want decoded growth")
	}
	if status.Growth.Next != 4 || status.Growth.NextName != "おとな" {
		t.Errorf("growth = %+v, want next=4 おとな", status.Growth)
	}
	if len(status.Growth.Gates) != 2 {
		t.Fatalf("gates = %+v, want 2 rows", status.Growth.Gates)
	}
	sharp := status.Growth.Gates[1]
	if sharp.Name != "sharpness" || sharp.Met || sharp.Value == nil || *sharp.Value != 0.49 {
		t.Errorf("gates[1] = %+v, want sharpness unmet value 0.49", sharp)
	}
	if sharp.Hint != "duelや質問に答えて好みを教える" {
		t.Errorf("gates[1].Hint = %q, want 本体の一手そのまま", sharp.Hint)
	}
}

func TestGetTomoStatus_growthのvalueがnullなら測定不能としてnilにデコードされる(t *testing.T) {
	// 本体 ADR-0046: null は「競争のある島が無い」等の測定不能で、0とは別の状態。
	withFakeTomobit(t, `echo '{"type":"status","exists":true,"stage":3,"stage_name":"わかもの","growth":{"next":4,"next_name":"おとな","gates":[{"name":"sharpness","value":null,"threshold":0.2,"met":false,"hint":"二人目のProviderに会わせる（autoに任せる）"}]}}'`)
	status, err := NewApp().GetTomoStatus()
	if err != nil {
		t.Fatal(err)
	}
	if status.Growth == nil || len(status.Growth.Gates) != 1 {
		t.Fatalf("growth = %+v, want 1 gate", status.Growth)
	}
	if got := status.Growth.Gates[0].Value; got != nil {
		t.Errorf("gates[0].Value = %v, want nil (測定不能を0にしない)", *got)
	}
}

func TestGetTomoStatus_growth欠落はnilにデコードされる(t *testing.T) {
	// 旧本体(ADR-0046以前)・最上位(あいぼう — 本体がフィールドごと省く)の両方を模す。
	withFakeTomobit(t, `echo '{"type":"status","exists":true,"stage":5,"stage_name":"あいぼう"}'`)
	status, err := NewApp().GetTomoStatus()
	if err != nil {
		t.Fatal(err)
	}
	if status.Growth != nil {
		t.Errorf("status.Growth = %+v, want nil", status.Growth)
	}
}

func TestGetTomoStatus_不正JSONは握り潰さずエラーを返す(t *testing.T) {
	withFakeTomobit(t, `echo 'not json'`)
	if _, err := NewApp().GetTomoStatus(); err == nil {
		t.Fatal("不正JSONなのにエラーが無い")
	}
}

func TestGetTomoStatus_空出力の正常終了もエラーになる(t *testing.T) {
	// exit 0 で何も書かないのは契約違反(1オブジェクト必須 — 本体 ADR-0039)。
	// 将来 stdout の空判定を特別扱いする変更が入っても仕様として残す。
	withFakeTomobit(t, `true`)
	if _, err := NewApp().GetTomoStatus(); err == nil {
		t.Fatal("空出力なのにエラーが無い")
	}
}

func TestGetTomoStatus_非ゼロ終了はstderrの文言をエラーに含める(t *testing.T) {
	// 旧本体の `--view` 未知エラーを模す(flagパッケージはstderrへ書いて終了)。
	withFakeTomobit(t, `echo 'flag provided but not defined: -view' >&2; exit 2`)
	_, err := NewApp().GetTomoStatus()
	if err == nil {
		t.Fatal("非ゼロ終了なのにエラーが無い")
	}
	if !strings.Contains(err.Error(), "flag provided but not defined") {
		t.Errorf("stderrの文言がエラーに含まれない: %v", err)
	}
}
