package main

// 2026-07-26 の応答停止で26分の会話が全損した件の再発防止。既定 OFF そのものは
// ADR-0003 Decision 0 のまま（同意の無い永続はしない）で、変えたのは「黙って
// OFF」をやめたこと。ここで固定するのは、書かないと決めた回でも、書いていない
// ことが人に届く、という一点。

import (
	"strings"
	"testing"
)

func TestNewScrollbackWriter_残さない設定なら書かずに一言添える(t *testing.T) {
	app := NewApp()
	// transcript_cache 未設定 = 既定 OFF（キー無しは false 扱い）。
	sb, diag := app.newScrollbackWriter(mainPane)

	if sb != nil {
		t.Fatal("同意が無いのに書き手を作っている")
	}
	if diag == "" {
		t.Fatal("全文を残していないことを誰にも言っていない")
	}
	// 案内先は設定ペインの実在のラベルと一致していること — 違う言葉で案内すると
	// 探しても見つからず、黙っているより悪い。
	if !strings.Contains(diag, "会話の全文を残す") {
		t.Fatalf("設定ペインのラベルへ案内していない: %q", diag)
	}
}

func TestNewScrollbackWriter_残す設定なら黙って書く(t *testing.T) {
	app := NewApp()
	on := true
	app.guiConfig.TranscriptCache = &on

	sb, diag := app.newScrollbackWriter(mainPane)

	if sb == nil {
		t.Fatal("同意があるのに書き手を作っていない")
	}
	// 残している回に注記は要らない: 言うべきことは「残っていない」だけ。
	if diag != "" {
		t.Fatalf("残しているのに注記が出ている: %q", diag)
	}
}
