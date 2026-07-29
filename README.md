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
  畳み状態は `gui.json` に残る。ADR-0006。姿がここに立つので**顔窓は既定OFF** —
  別窓の相棒も欲しい人は設定の「顔窓を開く」で二匹にできる。**残量は本体側で既定OFF** — 本体
  [ADR-0049](https://github.com/Rererr/tomobit/blob/main/docs/decisions/ADR-0049-quota-observation-is-opt-in.md)
  で `quota_observe` を有効にするまで、ゲージそのものが出ない）
- チャットからのコマンド実行（**既定OFF**。設定で有効にすると、Tomoの答えの中の
  sh/bash/zsh コードブロックに実行ボタンが出る。押すと確認の帯が開き、走る全文と
  作業ディレクトリを見せたうえで、もう一度押して初めて走る。結果は会話にも台帳にも
  残らない。ADR-0007）
- 待っていることの表示（送信から最初の1行までの沈黙——知覚・判断・Provider起動——を、
  会話の末尾の帯が「依頼中 / 実行中 · claude-code / 区切り中」と経過秒で言い続ける。
  段の遷移は本体のviewイベントだけから導く＝推測もタイムアウトもしない。ADR-0008）

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

- [ADR-0001](docs/decisions/ADR-0001-gui-architecture.md) — GUIは第三のレンダラ（台帳はひとつ / `tomobit chat` 子プロセス / メモリはro View / 喋り方は起動引数 / 姿は顔窓のまま——ただしサイドバーにも立つので顔窓の自動起動は既定OFF）
- [ADR-0002](docs/decisions/ADR-0002-tech-stack.md) — 技術スタック（Wails v2 / React + TypeScript strict / LLMは既存Provider経路=claude-code既定・API直結却下）
- [ADR-0003](docs/decisions/ADR-0003-session-transcript-cache.md) — 過去セッションの表示=スクロールバックの永続化（viewストリーム素通し追記・忘却より長生きしない・上限つき / **オプトイン・既定OFF**で先行実装 — 有効化するまで1バイトも書かない。既定の是非は所有者の裁定待ち）
- [ADR-0004](docs/decisions/ADR-0004-workspace-scope.md) — Tomoが働く場所（作業ディレクトリ=chat子プロセスのcwd / 読み取り先は本体の`/add-dir`へ宣言=Provider非依存 / 置き場はログと入力欄の間 / 反映は走行中のチャットにも届く。Decision 2/3 は本体ADR-0047を受けて改訂）
- [ADR-0005](docs/decisions/ADR-0005-closing-boundary.md) — 窓を閉じる前の締め（×で15秒固まっていたのは本体が境界の器官を走らせている時間だった / `OnBeforeClose` で閉窓を差し止め New chat と同じ `/exit` を送り、`await` の note をボタン化したモーダルで答える。選択肢は本体の行から読む＝GUIは語彙を持たない / 降りる道は「待たずに閉じる」1つで、そこでは猶予も捨てる）
- [ADR-0006](docs/decisions/ADR-0006-sidebar-standing-views.md) — サイドバーの常設View（ログとカテゴリの間に Tomo・Usage の開閉式セクション・既定は開いた姿・畳み状態は gui.json / Usage は残量だけを枠1本のゲージで〈逼迫80%だけ色を変える・観測できない枠にはバーを引かない〉、Provider別の利用実績はメモリペインに残す / 姿は本体 `tomobit-face --view json` の資産を canvas に描く — 瞬き・呼吸・気分記号まで顔窓と同じ数字で、GUIは格子を1つも持たない）
- [ADR-0007](docs/decisions/ADR-0007-run-command-from-chat.md) — チャットからのコマンド実行（**既定OFF・opt-in** / ボタンが出るのは sh・bash・zsh と申告されたフェンスだけ＝申告の無い塊をコマンドとみなさない / 1度目のクリックでは走らず、走る全文と作業ディレクトリを見せる帯を開いて2度目で走る — ただし帯は読まれなければ何も守らない、と ADR に明記 / `sh -c` でパイプもリダイレクトも通す＝argv分割は安全を買わないのに使えるコマンドだけを減らす / 結果は会話にもスクロールバックにも台帳にも残さない）
- [ADR-0008](docs/decisions/ADR-0008-waiting-is-visible.md) — 待っていることを画面で言う（送信〜最初の1行の沈黙＝知覚・判断・Provider起動を、会話の末尾の帯が「依頼中 / 実行中 · claude-code / 区切り中」＋経過秒で言い続ける / 段の遷移は本体ADR-0032の語彙だけから導く〈`ready` と `await` の note が終わりの合図。`turn.finished` では終わらせない — 推測もタイムアウトもしない〉/ 初回送信だけは順序が逆（`init`→`ready`→こちらの行を読む）なので、開いた直後の `ready` を1度だけ飲む / 動いていることを言う場所は1つ＝ターン枠の中の考え中ドットは撤去、締めダイアログにも同じ脈を添える）
- [ADR-0009](docs/decisions/ADR-0009-four-panes.md) — 窓は腕（会話面を1〜4分割し「Aリポのタスクα」「Bリポの作業」を同時に持つ / 本体ADR-0028 D4 が「端末が1本という物理が human の並走を禁じる — **判断ではなく制約の写像**」と書いた禁止を、その物理を持たない面で解除する / **Tomoは一匹**＝相棒らしさは台帳のView〈本体ADR-0019〉なので Tomo の同一性＝台帳の同一性・窓ごとにDBは選ばせない＝GUIをTomoを複数にできる唯一の口にしない / 分割するのは仕事の側（ログ・入力欄・働く場所・締め・待ち表示）、分割しないのはTomoの側（ヘッダ・成長・姿・Usage・セッション一覧） / 1窓=1プロセス=1セッションで起動は最初の送信まで遅延・締めは窓の中で完結しアプリの×は全窓を待つ / Tomo一匹の資源（好奇心予算・知覚・並走幅）は窓が食い合う＝増やせば台帳が嘘をつく / 同じ場所で働く窓があることは判断せず事実として言う。Accepted・**Phase 1〜4 実装済み**〈窓ごとの状態切り出し → 分割と締め → 働く場所を窓ごと → 資源の調停〉。Phase 4 は好奇心予算が既に台帳の導出Viewとして正しく動いていることが分かり、作ったのは知覚の逐次化だけ）
- [ADR-0010](docs/decisions/ADR-0010-verdict-in-the-session-view.md) — 判定は開いた人の手元に置く（本体ADR-0055 が第2層 `user.verdict` に書き手を与え、「入口が sid では遠い」と正直に書いた注記の Phase 3 / 置くのは**詳細**・印は**一覧**＝一覧に3つのボタンを並べると「気が向いた時」の器官が「見るたびに迫る」器官になる。一覧が既に持つ「例外だけ書く」規律〈finished は書かず進行中・中止・learning だけ注記〉に判定の印もそのまま乗る / **誰を判定できるかはGUIが決めない**＝本体が断る4つ〈中断・未終了・分割の子・amend済み〉の規則を写すとドリフトする。本体の断り文は「親の <sid> を判定する」まで書いてあるので、GUIが要約すると行き先が消える / 却下: status を見てボタンを隠す〈4つのうち2つしか隠せず「押せるボタンは通る」期待をどのみち作れない〉 / 押した通りには描かず台帳を読み直す＝本体が断ることがある / 確認ゲート無し〈clear で取り消せる＝可逆〉、かわりに効果を1行で見せる / 未知の語は印を出さない。Accepted・実装済み）
- [ADR-0011](docs/decisions/ADR-0011-parallel-subtask-frames.md) — 並走する子は、それぞれの枠で喋る（本体ADR-0056 が並走を実際に起こし、自分で書いた「既知の劣化」＝並走の子だけが端末用ラベル経由の note で届く、を閉じる / 本体ADR-0032 に `sub` / `sub_total` が増えたので、GUI 側は**何をどう描くか**だけを決める / D1 子は「もう一人の Tomo」ではなく**同じ Tomo の内訳**として縦に並べる〈却下: 横並び・列・進行バー3本＝同時性として見せる形。子は独立した発注ではない〈本体ADR-0054〉ので、横に並べると ADR-0009 が窓で守った「Tomo は一匹」の線が分割の軸で崩れる。チップと帯だけ＝**見分けはつくが別の生き物には見えない**〉 / D2 当て先は `sub` でしか決まらない（到着は入れ違う＝それが並走）。**先に終わった子が、まだ走っている枠を閉じない** / 当て先の規則は `SubtaskFrames` 1つに閉じ、ライブと過去の再生が共有する〈2箇所にあると片方だけ直した日に見え方が割れる — ADR-0003 D1 の線をコードの形で保つ〉 / D3 サブタスクの枠にユーザー発話を差し込まない〈あれは Provider が書いた内訳で人の言葉ではない〉 / D4 枠の無い行を捨てない。Accepted・実装済み。行が入れ違う3本を実UIへ流して1行も混ざらないことを確認〈LLM課金ゼロ〉）
- [ADR-0012](docs/decisions/ADR-0012-one-sheet-for-app-closing.md) — アプリの×は、全窓の締めを1枚に集める（閉場の待ち合わせがGo正本になった結果、アプリの×で窓の数だけ締めモーダルが同時に立った — 人がやりたいのは「全部に順に答えて帰る」であって3枚の行き来ではない、と本人指摘 / D1 App直下の全画面1枚に縦積み。見出しは**既にある事実の引用だけ**〈働く場所＋その窓の最初のユーザー発言。本体がintentを最初のuser行から作るのと同じ発想で、GUIは要約を発明しない＝ADR-0005 D2の線〉。質問は来た窓から答えられ、済んだ節は✓。閉じる機構には触らない〈1枚は見せ方〉。1窓でも同じ1枚＝分岐を増やさない / D2 `app:closing` に締め対象の窓一覧を載せ、載った窓だけ締めモードに入る〈会話していない窓が来ないexitを待つ「振り返っている…」を出さない〉 / D3 「待たずに閉じる」は1枚に1つ。窓単位のスキップは質問の「まだ言えない」〈空送信〉で足りる — ADR-0009追記の「窓ごとabandon」をこの2段構えで置き換え。Accepted・実装済み。実UI駆動で節の独立遷移・フォーカス巡回・引用を確認〈LLM課金ゼロ〉）
- [ADR-0013](docs/decisions/ADR-0013-permission-is-shown-before-it-is-granted.md) — 権限の問いは、形だけを借りる（ADR-0009 追記の論点1に答える。本体ADR-0053 が既定を `auto` にし権限要求を `{"type":"permission"}` の view note へ流したので、GUIに残るのは見せ方と返し方だけ / D1 **GUIは `--permission-mode` を渡さない**＝ADR-0007 が切った「便利さのために既定で開けてよい口ではない」に触らずに済む。`--provider` を常に明示で積むのとの非対称には理由があり、provider は gui.json が持つGUI側の値・権限モードはGUIが値を持たない〈却下: gui.json にノブ＝2箇所で決まる／既定で `open`＝ADR-0007 の否定〉 / D2 モーダルは**形だけ**。道具の名前も選択肢も文面も本体の行から読む〈ADR-0005 D2〉。**種類は `type` で判り、文面から当てない**＝文言が変わった日に黙って壊れる / D3 読めない形はモーダルにせず会話面の1行へ落とす＝**GUIが読めないことと人が答えられないことは別** / D4 **見せてから許す**〈ADR-0007 の作法〉。初期フォーカスは `preventScroll: true`＝未指定だと道具一覧が長いとき許可ボタンまで自動スクロールし押す前に対象が視野から消える〈実測 scrollTop 282 で Tool 1〜6 不可視〉。再実行の費用も隠さない。Accepted・実装済み〈c0fff21 / c4ddaf9〉。後追い起票）
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
