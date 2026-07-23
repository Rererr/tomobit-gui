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
