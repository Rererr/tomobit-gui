# ADR-0002: 技術スタック — Wails v2 / React + TypeScript / LLMは既存Provider経路

- Status: **Accepted**
- Date: 2026-07-19
- 関連: [ADR-0001](ADR-0001-gui-architecture.md)（アーキテクチャ）,
  tomobit本体 ADR-0004（Go採用の理由）, ADR-0029（知覚バックエンド）

---

## Context

ADR-0001でGUIの仕事は確定した: `tomobit chat` 子プロセスのプロセス管理と
ストリーム配管、SQLiteの読み取り専用View、設定ファイルの読み書き。
つまり**バックエンドの仕事は本体と同じ形**をしている。
その上にChatGPT寄りのチャットUI（サイドバー・スレッド・入力欄・Markdown表示）を載せる。

---

## Decision 1: アプリシェル = Wails v2

Go製のデスクトップアプリシェル。システムWebView（macOSはWKWebView）に
フロントエンドを描き、Go側とtyped bindingで結ぶ。単一の.appになる。

- **Goであること**が決定打: 子プロセス管理・ストリームI/O・SQLiteは
  本体ADR-0004が「Goのホームグラウンド」と確定した領域そのもの。
  使用者がGoを好きというモチベーション条項もそのまま効く
- Chromium同梱なし。バイナリ数十MB・システムWebView利用で低負荷
- 実機検証済み（2026-07-19）: wails v2.13.0 / Go 1.26.5 / macOS 26.5 (M4 Pro) で
  `wails doctor` 全依存OK（Xcode CLT・Node 26.5.0・npm 11.17.0）

却下した対案:

- **Electron** → Chromium同梱で数百MB・メモリ占有大。低負荷の軸に反する。
  GUIの仕事量（配管とView）に対してランタイムが過大
- **Tauri v2** → シェルとしては同等だが、バックエンドがRustになる。
  本体ADR-0004がRustを退けた理由（反復速度・モチベーション）が再適用される上、
  ここでの仕事（子プロセス+パイプ+SQLite）はGoの得意領域
- **Ebiten**（顔窓と同じ） → ゲームエンジンにチャットUIのテキストレイアウト・
  IME入力・スクロール・選択コピーを自前実装することになる。顔窓とは仕事が違う
- **Slint**（bpsr-checkerで実績） → リッチテキストのチャットログ表示が弱く、
  Rustバックエンドになる点もTauriと同じ
- **Goサーバ + ブラウザ** → 構成はほぼ同じだが、アプリとしての座席
  （Dock・ウィンドウ・顔窓との並び）がない。Wailsは同構成にネイティブシェルが
  ほぼ同コストで付く形なので、あえてブラウザに退く理由がない
- **Wails v3** → まだalpha。v2は安定版

## Decision 2: フロントエンド = React + TypeScript (strict) + Vite

- ChatGPT寄りのUI（サイドバー+チャットスレッド+入力欄）はWebの流儀が最短距離。
  Wails公式テンプレート（react-ts）から始める
- TypeScriptは `strict: true`。Go↔JS境界はWailsの生成バインディングで型を通す
- UIライブラリ・CSSフレームワークは雛形段階では固定しない（素のCSSで骨格を
  作り、必要になった時点で選ぶ。雛形に依存を積まない）

### 追記（2026-07-21・Markdown描画ライブラリの採用）

Tomoの発言（LLMの生出力）がMarkdown記法のまま表示されていた実測を受け、
`react-markdown` + `remark-gfm` を採用した。「必要になった時点で選ぶ」の実行。

- **rehype-rawは使わない**: 生HTMLをASTに含めて実行する経路を作らず、
  remarkのAST→React要素の変換だけで完結させる。Tomoの出力は信頼できる
  ローカルProvider由来だが、XSS経路を増やさない設計をコストゼロで選べるなら
  そちらを取る
- 却下した対案: `marked` 等でHTML文字列化 → `dangerouslySetInnerHTML` —
  同じ理由（生HTML実行経路を作る）で却下
- リンクは素の `<a target="_blank">` にしない: WailsのWebViewは別ウィンドウの
  browser chromeを持たないため、ナビゲートするとアプリの中身が消える。
  Wails runtimeの `BrowserOpenURL` でシステムブラウザに渡す

## Decision 3: LLM API/モデル = 新規選定しない — 既存Provider経路に乗る

会話のLLMは `tomobit chat` のProvider機構（claude-code / codex / human / auto）を
そのまま使う。**既定はclaude-code（= Claude）**。モデルはclaude CLI側の設定に
従い、GUIは固定しない（Providerの`/provider`切替・autoの台帳采配もそのまま効く）。

- **Anthropic API (SDK) 直結を却下した理由**:
  1. chat→台帳の器官一式（記帳・ダイジェスト・区切りの尾部）を再実装する
     二重帳簿になる — ADR-0001の却下理由と同根で、これが最重
  2. APIキー管理と従量課金が新たに発生する。claude-code CLI経由なら
     既存のサブスクリプション運用のまま
  3. 「AIは交換可能」（本体ADR-0004がSDKロックインを退けた理由）を失う。
     GUIに固有のLLMの座席を作らないことが、経験を一つの台帳に積む前提を守る
- 知覚のLLMは変更なし（MLX LM + Qwen3-8B-4bit、本体ADR-0029の既定のまま）。
  GUIは知覚に触れない — 知覚は本体の器官であり、GUIはその結果をViewで見るだけ

---

## Consequences

- リポジトリ構成: Wails標準（ルートにGo、`frontend/` にReact+TS）
- 開発は `wails dev`（ホットリロード）、配布物は `wails build`（.app）
- GUIが増やす恒常依存はWailsのみ。LLM・DB・器官はすべて本体の資産を使う
- 雛形の完了条件: `wails build` が通り、生成された.appが起動して
  3ペイン骨格（サイドバー・チャット面・入力欄と設定/メモリのプレースホルダ）が
  表示されること
- 次の実装（別タスク）: chat子プロセス配線 → 喋り方設定 → メモリView
