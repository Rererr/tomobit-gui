# tomobit-gui

> **Tomobit is not built to use AI. Tomobit is built to grow with it.**

[tomobit](https://github.com/Rererr/tomobit) のChatGPT寄りチャットGUI。
端末・顔窓に続く**第三のレンダラ + 入力の器**であり、会話は本体の
`tomobit chat`（pipe mode）を透過して単一の台帳（`~/.tomobit/tomobit.db`）に積まれる。
GUIは新しい真実を作らない — Tomoは入口によらず同じ台帳で育つ。

## スコープ

- チャット本体（`tomobit chat` 子プロセスのストリーム表示。New chat = 区切りの宣言で、
  締めの質問→知覚→Tomoの一言まで同じ画面に流れる）
- 好みの喋り方の設定（`~/.tomobit/gui.json` に保存し、Provider起動引数
  `--append-system-prompt` へ注入。台帳は汚れない。反映は次のNew chatで区切った後から）
- 簡易メモリ管理（connections / experiences / curiosity_queue の読み取り専用View。
  記憶は会話から積まれる — 編集・削除の器官はまだ無い）

ユーザープロフィール機能は持たない。

## セットアップ

前提: macOS / Go 1.26+ / Node + npm。

1. 本体を入れて動く状態にする（[tomobit](https://github.com/Rererr/tomobit) 参照）:

   ```
   git clone https://github.com/Rererr/tomobit && cd tomobit
   go install ./cmd/tomobit        # → ~/go/bin/tomobit
   ```

   会話には Provider（既定 claude-code = `claude` CLI）が要る。区切り時の知覚は
   本体の知覚バックエンド（MLX LMサーバー）が担うが、止まっていても会話はでき、
   知覚は pending に積まれて後から `tomobit perceive` で消化できる。

2. wails CLI を入れてビルド:

   ```
   go install github.com/wailsapp/wails/v2/cmd/wails@latest
   git clone https://github.com/Rererr/tomobit-gui && cd tomobit-gui
   wails build                     # → build/bin/tomobit-gui.app（frontendのnpm installはwailsが行う）
   ```

## 起動

```
open build/bin/tomobit-gui.app
```

`tomobit` は PATH か `~/go/bin` にあれば見つかる（Finder起動のPATH欠落対策済み）。
話しかけると `tomobit chat` が子プロセスで立ち、台帳は端末と同じ場所に積まれる。
「New chat」が区切りの宣言 — 締めの質問に答える（Enter = まだ言えない）と知覚が走り、
メモリペインに経験と Tomo の理解が現れる。

## Docs

- [ADR-0001](docs/decisions/ADR-0001-gui-architecture.md) — GUIは第三のレンダラ（台帳はひとつ / `tomobit chat` 子プロセス / メモリはro View / 喋り方は起動引数 / 姿は顔窓のまま）
- [ADR-0002](docs/decisions/ADR-0002-tech-stack.md) — 技術スタック（Wails v2 / React + TypeScript strict / LLMは既存Provider経路=claude-code既定・API直結却下）
- [BACKLOG](docs/BACKLOG.md) — 残課題（本体側の設計待ち / GUI側の未実装）

## Stack

**Go (Wails v2) / React + TypeScript / システムWebView**。
会話LLMは本体のProvider機構（既定claude-code）、知覚は本体の器官のまま（GUIは触れない）。

## 開発

```
wails dev      # ホットリロード開発（http://localhost:34115 でブラウザからも駆動できる）
wails build    # build/bin/tomobit-gui.app を生成
```

検証:

```
go test ./...                        # ユニット
TOMOBIT_GUI_E2E=1 go test -run TestE2E ./...   # 実Provider検証(実APIを1ターン・台帳は使い捨てDBに隔離)
```

開発時は本体の env オーバーライドがそのまま子プロセスに効く
（`TOMOBIT_DB` で使い捨て台帳、`TOMOBIT_CLAUDE_ARGS` でモデル指定など）。
実GUIの通し検証は `wails dev` の localhost:34115 を playwright-core（`channel: "chrome"`）で
駆動する — バインド済みGoメソッドもイベントもブラウザ経由でそのまま動く。
