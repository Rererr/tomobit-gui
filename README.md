# tomobit-gui

> **Tomobit is not built to use AI. Tomobit is built to grow with it.**

*English: [README.en.md](README.en.md)（正本はこの日本語版）*

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
- Tomoが働く場所の設定（チャットのログと入力欄の間の作業バー。端末の `cd` にあたる
  表明で、Providerによらず効く（本体ADR-0047）。走行中のチャットにもその場で届く —
  ただしタスクの途中なら本体が「/new で区切ってから」と答える）
- 窓を閉じる前の締め（×は即座には閉じず、本体の境界の器官——Feedback→知覚→質問→鏡——を
  走らせる。質問はポップアップのボタンで答える。ADR-0005）
- サイドバーの常設View（Tomoの姿と、Provider別の利用・残量。どちらも開閉式で、
  畳み状態は `gui.json` に残る。ADR-0006。**残量は本体側で既定OFF** — 本体
  [ADR-0049](https://github.com/Rererr/tomobit/blob/main/docs/decisions/ADR-0049-quota-observation-is-opt-in.md)
  で `quota_observe` を有効にするまで、ゲージそのものが出ない）
- チャットからのコマンド実行（**既定OFF**。設定で有効にすると、Tomoの答えの中の
  sh/bash/zsh コードブロックに実行ボタンが出る。押すと確認の帯が開き、走る全文と
  作業ディレクトリを見せたうえで、もう一度押して初めて走る。結果は会話にも台帳にも
  残らない。ADR-0007）

ユーザープロフィール機能は持たない。

## セットアップ

前提: macOS / Go 1.26+ / Node + npm。

1. 本体を入れて動く状態にする（[tomobit](https://github.com/Rererr/tomobit) 参照）:

   ```
   git clone https://github.com/Rererr/tomobit && cd tomobit
   go install ./cmd/tomobit        # → ~/go/bin/tomobit
   go install ./cmd/tomobit-face   # → ~/go/bin/tomobit-face（顔窓 + 姿の資産）
   ```

   本体は ADR-0039（`status --view json`、2026-07-24）実装済みの版であること。
   旧本体でも動くが、ヘッダのステージ表示が素の「Tomo」に落ちる。
   サイドバーのTomoは `tomobit-face --view json`（本体 ADR-0048、2026-07-25）を読む —
   旧顔窓・未インストールなら、そのセクションだけが黙って出ない。

   会話には Provider（既定 claude-code = `claude` CLI）が要る。区切り時の知覚は
   本体の知覚バックエンド（MLX LMサーバー）が担うが、止まっていても会話はでき、
   知覚は pending に積まれて後から `tomobit perceive` で消化できる。

2. wails CLI を入れてビルド:

   ```
   go install github.com/wailsapp/wails/v2/cmd/wails@latest
   git clone https://github.com/Rererr/tomobit-gui && cd tomobit-gui
   ```

3. 端末から起動できる形で入れる（推奨。核 tomobit と同じ `go install` 流儀で
   `$GOBIN`（既定 `~/go/bin`）へ本番ビルドを置く。以後どこからでも `tomobit-gui`）:

   ```
   make install                    # frontend build → go install（Wails と同一の -tags/-ldflags）
   ```

   配布物の `.app` が要るとき（Finder/Launchpad から起動したいとき）は代わりに:

   ```
   wails build                     # → build/bin/tomobit-gui.app（frontendのnpm installはwailsが行う）
   ```

## 起動

```
tomobit-gui                        # make install 済みなら端末から
open build/bin/tomobit-gui.app     # wails build の .app から
```

`tomobit` は PATH か `~/go/bin` にあれば見つかる（Finder起動のPATH欠落対策済み）。
話しかけると `tomobit chat` が子プロセスで立ち、台帳は端末と同じ場所に積まれる。
「New chat」が区切りの宣言 — 締めの質問に答える（Enter = まだ言えない）と知覚が走り、
メモリペインに経験と Tomo の理解が現れる。

## Docs

- [ADR-0001](docs/decisions/ADR-0001-gui-architecture.md) — GUIは第三のレンダラ（台帳はひとつ / `tomobit chat` 子プロセス / メモリはro View / 喋り方は起動引数 / 姿は顔窓のまま）
- [ADR-0002](docs/decisions/ADR-0002-tech-stack.md) — 技術スタック（Wails v2 / React + TypeScript strict / LLMは既存Provider経路=claude-code既定・API直結却下）
- [ADR-0003](docs/decisions/ADR-0003-session-transcript-cache.md) — 過去セッションの表示=スクロールバックの永続化（viewストリーム素通し追記・忘却より長生きしない・上限つき / **オプトイン・既定OFF**で先行実装 — 有効化するまで1バイトも書かない。既定の是非は所有者の裁定待ち）
- [ADR-0004](docs/decisions/ADR-0004-workspace-scope.md) — Tomoが働く場所（作業ディレクトリ=chat子プロセスのcwd / 読み取り先は本体の`/add-dir`へ宣言=Provider非依存 / 置き場はログと入力欄の間 / 反映は走行中のチャットにも届く。Decision 2/3 は本体ADR-0047を受けて改訂）
- [ADR-0005](docs/decisions/ADR-0005-closing-boundary.md) — 窓を閉じる前の締め（×で15秒固まっていたのは本体が境界の器官を走らせている時間だった / `OnBeforeClose` で閉窓を差し止め New chat と同じ `/exit` を送り、`await` の note をボタン化したモーダルで答える。選択肢は本体の行から読む＝GUIは語彙を持たない / 降りる道は「待たずに閉じる」1つで、そこでは猶予も捨てる）
- [ADR-0006](docs/decisions/ADR-0006-sidebar-standing-views.md) — サイドバーの常設View（ログとカテゴリの間に Tomo・Usage の開閉式セクション・既定は開いた姿・畳み状態は gui.json / Usage は残量だけを枠1本のゲージで〈逼迫80%だけ色を変える・観測できない枠にはバーを引かない〉、Provider別の利用実績はメモリペインに残す / 姿は本体 `tomobit-face --view json` の資産を canvas に描く — 瞬き・呼吸・気分記号まで顔窓と同じ数字で、GUIは格子を1つも持たない）
- [ADR-0007](docs/decisions/ADR-0007-run-command-from-chat.md) — チャットからのコマンド実行（**既定OFF・opt-in** / ボタンが出るのは sh・bash・zsh と申告されたフェンスだけ＝申告の無い塊をコマンドとみなさない / 1度目のクリックでは走らず、走る全文と作業ディレクトリを見せる帯を開いて2度目で走る — ただし帯は読まれなければ何も守らない、と ADR に明記 / `sh -c` でパイプもリダイレクトも通す＝argv分割は安全を買わないのに使えるコマンドだけを減らす / 結果は会話にもスクロールバックにも台帳にも残さない）
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

## 貢献 / セキュリティ

- [CONTRIBUTING.md](CONTRIBUTING.md) — **CLAは採りません**（DCO / `git commit -s`）。
  GUIは第三のレンダラであって新しい真実を作らない、という原則を先に読んでください
- [SECURITY.md](SECURITY.md) — 脆弱性の非公開報告と、このアプリが触るもの

## License

**コードと文書で分けています**（本体 [tomobit](https://github.com/Rererr/tomobit) と同じ方針）。

| 対象 | ライセンス |
|---|---|
| `docs/` 以下の文書、`README.md` | [CC BY-SA 4.0](LICENSE-docs) |
| 上記以外のすべて（Go・TypeScript・CSS・`build/` 資産） | [AGPL-3.0-only](LICENSE) |

© 2026 Rererr

`frontend/wailsjs/` 配下は [Wails](https://github.com/wailsapp/wails)（MIT）の生成物です。
引用は本体の [CITATION.cff](https://github.com/Rererr/tomobit/blob/main/CITATION.cff) を使ってください。
