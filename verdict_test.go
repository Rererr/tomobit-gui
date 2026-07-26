package main

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

// 第2層の口 (本体 ADR-0055 Decision 2)。GUIはDBに書かず、本体の動詞を呼ぶ —
// forget/amend と同じ経路で、契約は「引数列」と「stdout の1行サマリ」である。

func TestSetVerdict_本体のverdictを呼ぶ(t *testing.T) {
	for _, word := range []string{"up", "down", "clear"} {
		calls := captureRunner(t, "verdict: s-1 -> "+word+" (ver 5, rebuilt: 3 connections)\n", "", nil)
		res, err := NewApp().SetVerdict("s-1", word)
		if err != nil {
			t.Fatal(err)
		}
		want := []string{"verdict", "s-1", word}
		if len(*calls) != 1 || !reflect.DeepEqual((*calls)[0], want) {
			t.Fatalf("CLI引数が契約と違う: %v", *calls)
		}
		if !strings.Contains(res.Summary, word) {
			t.Errorf("本体の1行サマリがそのまま返らない: %q", res.Summary)
		}
	}
}

// 誰を判定できるかはGUIが決めない (本体が中断・未終了・分割の子・amend済みを
// 断る)。断り文はそのまま人へ届く — あちらは「親の <sid> を判定する」まで
// 書いてあるので、写して薄めるより届く。
func TestSetVerdict_本体の断り文をそのまま返す(t *testing.T) {
	captureRunner(t, "", "verdict: k は分割の子で、経験を持たない（ADR-0054）。親の p を判定する\n",
		errors.New("exit status 1"))
	_, err := NewApp().SetVerdict("k", "up")
	if err == nil {
		t.Fatal("本体が断ったのにエラーにならない")
	}
	if !strings.Contains(err.Error(), "親の p を判定する") {
		t.Errorf("本体の文言が落ちている: %v", err)
	}
}

// タイポでプロセスを起こさないための最小の門。これは検証ではなく、
// 検証は本体が唯一の担い手である。
func TestSetVerdict_語彙外とidなしはCLIを起こさない(t *testing.T) {
	for _, tc := range []struct{ sid, word string }{
		{"s-1", "sideways"},
		{"s-1", ""},
		{"", "up"},
		{"   ", "up"},
	} {
		calls := captureRunner(t, "", "", nil)
		if _, err := NewApp().SetVerdict(tc.sid, tc.word); err == nil {
			t.Errorf("SetVerdict(%q,%q) がエラーにならない", tc.sid, tc.word)
		}
		if len(*calls) != 0 {
			t.Errorf("SetVerdict(%q,%q) がCLIを起こした: %v", tc.sid, tc.word, *calls)
		}
	}
}

// ---- 一覧・詳細が見せる「いまの判定」 ----

func TestGetSessions_判定は最後が勝ちclearで消える(t *testing.T) {
	path := newTestLedger(t)
	// 何も置かれていない
	addEvent(t, path, "s-none", 1, 1000, "task.started", `{"intent":"判定なし"}`)
	addEvent(t, path, "s-none", 2, 1100, "task.finished", `{}`)
	// 置き換え: up → down
	addEvent(t, path, "s-flip", 1, 2000, "task.started", `{"intent":"置き換えた"}`)
	addEvent(t, path, "s-flip", 2, 2100, "task.finished", `{}`)
	addEvent(t, path, "s-flip", 3, 2200, "user.verdict", `{"verdict":"up"}`)
	addEvent(t, path, "s-flip", 4, 2300, "user.verdict", `{"verdict":"down"}`)
	// 取り消し: down → clear
	addEvent(t, path, "s-clear", 1, 3000, "task.started", `{"intent":"取り消した"}`)
	addEvent(t, path, "s-clear", 2, 3100, "task.finished", `{}`)
	addEvent(t, path, "s-clear", 3, 3200, "user.verdict", `{"verdict":"down"}`)
	addEvent(t, path, "s-clear", 4, 3300, "user.verdict", `{"verdict":"clear"}`)
	// 未知の語は印を出さない (ADR-0032 の消費者規律)
	addEvent(t, path, "s-odd", 1, 4000, "task.started", `{"intent":"未知の語"}`)
	addEvent(t, path, "s-odd", 2, 4100, "task.finished", `{}`)
	addEvent(t, path, "s-odd", 3, 4200, "user.verdict", `{"verdict":"sideways"}`)

	t.Setenv("TOMOBIT_DB", path)
	list, err := NewApp().GetSessions()
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, s := range list.Sessions {
		got[s.SessionID] = s.Verdict
	}
	want := map[string]string{"s-none": "", "s-flip": "down", "s-clear": "", "s-odd": ""}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("一覧の判定 = %v, want %v", got, want)
	}
}

func TestGetSessionDigest_詳細も同じ判定を返す(t *testing.T) {
	path := newTestLedger(t)
	addEvent(t, path, "s-1", 1, 1000, "task.started", `{"intent":"やったこと"}`)
	addEvent(t, path, "s-1", 2, 1100, "task.finished", `{}`)
	addEvent(t, path, "s-1", 3, 1200, "user.verdict", `{"verdict":"up"}`)

	t.Setenv("TOMOBIT_DB", path)
	detail, err := NewApp().GetSessionDigest("s-1")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Verdict != "up" {
		t.Errorf("詳細の判定 = %q, want up", detail.Verdict)
	}
	// 判定はダイジェストの行にはならない — 会話の出来事ではないので、
	// 本文の時系列に混ぜない。
	for _, item := range detail.Items {
		if strings.Contains(item.Text, "verdict") || strings.Contains(item.Text, "up") {
			t.Errorf("判定が本文の行として混ざった: %+v", item)
		}
	}
}
