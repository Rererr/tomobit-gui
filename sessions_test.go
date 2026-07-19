package main

import (
	"database/sql"
	"path/filepath"
	"testing"
)

// セッション一覧のテストは What = 台帳のダイジェストからの要約(ADR-0001
// Consequences): task.started を持つセッションだけが新しい順に並び、
// ターン数・状態・ダイジェスト時系列が読める。GUIは events を書かない。

func addEvent(t *testing.T, path, sid string, seq int, ts int64, typ, payload string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT INTO events (session_id, seq, ts, type, payload)
		VALUES (?, ?, ?, ?, ?)`, sid, seq, ts, typ, payload); err != nil {
		t.Fatal(err)
	}
}

func TestGetSessions_taskStartedを持つセッションが新しい順に並ぶ(t *testing.T) {
	path := newTestLedger(t)
	addEvent(t, path, "s-old", 1, 1000, "task.started", `{"intent":"古いタスク","source":"production"}`)
	addEvent(t, path, "s-old", 2, 1100, "task.turn", `{"intent":"続き","n":2}`)
	addEvent(t, path, "s-old", 3, 1200, "task.finished", `{}`)
	addEvent(t, path, "s-new", 1, 2000, "task.started", `{"intent":"新しいタスク"}`)
	// task.started を持たないセッション(tomo.greeted 単発)は一覧に出ない。
	addEvent(t, path, "s-greet", 1, 3000, "tomo.greeted", `{"absent_ms":1}`)

	t.Setenv("TOMOBIT_DB", path)
	list, err := NewApp().GetSessions()
	if err != nil {
		t.Fatal(err)
	}
	if !list.Exists {
		t.Fatal("既存のdbなのにExists=false")
	}
	if len(list.Sessions) != 2 {
		t.Fatalf("Sessions = %+v, want 2件", list.Sessions)
	}
	if list.Sessions[0].SessionID != "s-new" || list.Sessions[1].SessionID != "s-old" {
		t.Errorf("並び順が新しい順でない: %+v", list.Sessions)
	}
	old := list.Sessions[1]
	if old.Intent != "古いタスク" || old.Turns != 2 || old.Status != "finished" ||
		old.Source != "production" || old.StartTS != 1000 || old.EndTS != 1200 {
		t.Errorf("要約が台帳と食い違う: %+v", old)
	}
	if list.Sessions[0].Status != "open" {
		t.Errorf("終端イベントの無いセッションは open のはず: %+v", list.Sessions[0])
	}
}

func TestGetSessions_DB無しはExistsFalseでエラーにならない(t *testing.T) {
	t.Setenv("TOMOBIT_DB", filepath.Join(t.TempDir(), "no-such.db"))
	list, err := NewApp().GetSessions()
	if err != nil {
		t.Fatal(err)
	}
	if list.Exists || len(list.Sessions) != 0 {
		t.Errorf("list = %+v, want Exists=false かつ空", list)
	}
}

func TestGetSessionDigest_ダイジェスト時系列を再構成する(t *testing.T) {
	path := newTestLedger(t)
	sid := "s-digest"
	addEvent(t, path, sid, 1, 1000, "task.started", `{"intent":"最初の依頼"}`)
	addEvent(t, path, sid, 2, 1001, "capability.started", `{"capability":"implement"}`) // 未知扱い: 無視
	addEvent(t, path, sid, 3, 1002, "provider.selected", `{"provider":"claude-code","model":"haiku"}`)
	addEvent(t, path, sid, 4, 1003, "provider.output", `{"text":"了解した"}`)
	addEvent(t, path, sid, 5, 1004, "provider.output", `{"tool":"Bash"}`)
	addEvent(t, path, sid, 6, 1005, "provider.error", `{"message":"error_during_execution"}`)
	addEvent(t, path, sid, 7, 1006, "task.turn", `{"intent":"続けて","n":2}`)
	addEvent(t, path, sid, 8, 1007, "task.cancelled", ``)

	t.Setenv("TOMOBIT_DB", path)
	detail, err := NewApp().GetSessionDigest(sid)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Status != "cancelled" || detail.StartTS != 1000 {
		t.Errorf("detail = %+v", detail)
	}
	want := []DigestItem{
		{Kind: "user", Text: "最初の依頼", N: 1},
		{Kind: "provider", Text: "claude-code (haiku)"},
		{Kind: "tomo", Text: "了解した"},
		{Kind: "tool", Text: "Bash"},
		{Kind: "error", Text: "error_during_execution"},
		{Kind: "user", Text: "続けて", N: 2},
	}
	if len(detail.Items) != len(want) {
		t.Fatalf("Items = %+v, want %d件", detail.Items, len(want))
	}
	for i, w := range want {
		if detail.Items[i] != w {
			t.Errorf("Items[%d] = %+v, want %+v", i, detail.Items[i], w)
		}
	}
}
