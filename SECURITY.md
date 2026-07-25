# セキュリティ / Security Policy

## 報告方法 / Reporting a vulnerability

**公開Issueに書かないでください。** GitHubの
[Private vulnerability reporting](https://github.com/Rererr/tomobit-gui/security/advisories/new)
から非公開で報告してください。

Please do **not** open a public issue. Use GitHub's private vulnerability
reporting instead. 日本語・English どちらでも構いません。

台帳・知覚・Provider起動そのものに関わる報告は、本体
[tomobit の SECURITY.md](https://github.com/Rererr/tomobit/blob/main/SECURITY.md) へ
お願いします。GUIは新しい真実を作らず、本体を透過するだけです。

## このGUIが触るもの / What this app touches

- **`tomobit chat --view ndjson` の子プロセス起動** — 会話も記帳も本体が行います。
  GUIは台帳へ直接書きません
- **台帳の読み取り** — メモリペイン・サイドバーは `~/.tomobit/tomobit.db` を
  読み取り専用で参照します（**実会話の内容を画面に表示します**）
- **`~/.tomobit/gui.json`** — 喋り方・作業ディレクトリ・畳み状態などのGUI設定。
  台帳とは別ファイルで、経験は入りません
- **スクロールバックの永続化（既定OFF・opt-in）** — 有効化するまで**1バイトも書きません**
  （[ADR-0003](docs/decisions/ADR-0003-session-transcript-cache.md)）。
  有効化した場合、**会話全文がディスクに残ります**
- **システムWebView** — Wails v2 が使うOS標準のWebView。外部へのネットワーク接続は
  アプリからは行いません（`wails dev` 時のみ localhost:34115 を開きます）

## 対象範囲 / Scope

台帳・スクロールバックの内容が意図せず外部へ出る経路、子プロセス起動時の引数・
環境変数の注入経路、WebViewへのコンテンツ注入は、報告の対象です。

Wails / WebView / Provider CLI 自体の脆弱性は、それぞれの提供元へ報告してください。
