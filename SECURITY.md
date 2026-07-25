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
- **チャットからのコマンド実行（既定OFF・明示的なopt-in）** — `gui.json` の
  `run_command` が `true` のときだけ、Tomoの答えの中の sh/bash/zsh コードブロックに
  実行ボタンが出ます。**有効にするまで、ボタンは存在しません**
  （[ADR-0007](docs/decisions/ADR-0007-run-command-from-chat.md)）。
  有効にした場合、押すと確認の帯が開き、走るコマンドの全文と作業ディレクトリを
  提示したうえで、**もう一度押して初めて `sh -c` で実行します**。
  これは**モデルが書いた文字列を人がワンクリックで実行する経路**です —
  確認の帯が守るのは「読む機会が1回ある」ことまでで、読まれなければ何も守りません。
  結果は会話にも台帳にも残りません
- **システムWebView** — Wails v2 が使うOS標準のWebView。外部へのネットワーク接続は
  アプリからは行いません（`wails dev` 時のみ localhost:34115 を開きます）

## 対象範囲 / Scope

台帳・スクロールバックの内容が意図せず外部へ出る経路、子プロセス起動時の引数・
環境変数の注入経路、WebViewへのコンテンツ注入は、報告の対象です。

コマンド実行（ADR-0007）については、**確認の帯を経ずに実行できる経路**、
**帯に出した文字列と実際に走る文字列が食い違う経路**、
**設定OFFのまま実行できる経路**が報告の対象です。有効にしたうえで人が確認して
押した実行そのものは、設計どおりの動作です。

Wails / WebView / Provider CLI 自体の脆弱性は、それぞれの提供元へ報告してください。
