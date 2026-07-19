# tomobit-gui

> **Tomobit is not built to use AI. Tomobit is built to grow with it.**

[tomobit](https://github.com/Rererr/tomobit) のChatGPT寄りチャットGUI。
端末・顔窓に続く**第三のレンダラ + 入力の器**であり、会話は本体の
`tomobit chat`（pipe mode）を透過して単一の台帳（`~/.tomobit/tomobit.db`）に積まれる。
GUIは新しい真実を作らない — Tomoは入口によらず同じ台帳で育つ。

## スコープ

- チャット本体（`tomobit chat` 子プロセスのストリーム表示・New chat = `/new`）
- 好みの喋り方の設定（Provider起動引数 `--append-system-prompt` への注入）
- 簡易メモリ管理（connections / experiences / curiosity_queue の読み取り専用View）

ユーザープロフィール機能は持たない。

## Docs

- [ADR-0001](docs/decisions/ADR-0001-gui-architecture.md) — GUIは第三のレンダラ（台帳はひとつ / `tomobit chat` 子プロセス / メモリはro View / 喋り方は起動引数 / 姿は顔窓のまま）
- [ADR-0002](docs/decisions/ADR-0002-tech-stack.md) — 技術スタック（Wails v2 / React + TypeScript strict / LLMは既存Provider経路=claude-code既定・API直結却下）

## Stack

**Go (Wails v2) / React + TypeScript / システムWebView**。
会話LLMは本体のProvider機構（既定claude-code）、知覚は本体の器官のまま（GUIは触れない）。

## 開発

```
wails dev      # ホットリロード開発
wails build    # build/bin/tomobit-gui.app を生成
```

前提: Go 1.26+ / Node / npm / wails v2 CLI（`go install github.com/wailsapp/wails/v2/cmd/wails@latest`）、
実行時は PATH 上の `tomobit`（本体）。
