# ADR-0001: GUIは第三のレンダラ — 台帳はひとつ

- Status: **Accepted**
- Date: 2026-07-19
- 関連（tomobit本体）: [VISION.ja.md](https://github.com/Rererr/tomobit/blob/main/VISION.ja.md),
  ADR-0004（技術選定・単一SQLite）, ADR-0018（経験主権）, ADR-0020（顔窓=第二のレンダラ）,
  ADR-0021（配線は経験ではない）, ADR-0022（対話セッション）, ADR-0025（顔窓の自動起動）

---

## Context

tomobit本体は端末UIの相棒である。姿はEbitenの顔窓（第二のレンダラ、ADR-0020）が担い、
対話は `tomobit chat`（ADR-0022）が担う。ここにChatGPT寄りのチャットGUIを加える。

スコープはチャット本体・好みの喋り方の設定・簡易的なメモリ管理の3つ。
ユーザープロフィール機能は持たない。

最優先はVISIONである。Tomobitの存在理由は「共に経験を積み、共に成長する」ことにあり、
**GUIで交わした会話が台帳に載らないなら、そのGUIはTomobitではない**。
GUIが独自の会話DBと独自のLLM呼び出しを持てば、経験は二つの帳簿に割れ、
Tomoは片方でしか育たない。ADR-0020が顔窓で退けた「二重帳簿」の会話版である。

---

## Decision 1: GUIは第三のレンダラ + 入力の器。新しい真実を作らない

tomobit-guiは、端末・顔窓に続く三つ目のレンダラであり、同時に入力の器である。

- 真実は本体の単一SQLite（`~/.tomobit/tomobit.db`）のまま。GUIは会話DBを持たない
- 「1セッション = 1タスク = 1 Experience、区切りは人間が宣言する」（ADR-0022）を
  そのまま使う。GUIの「New chat」= 区切りの宣言である
  （実装は `/exit` 経由 — Decision 4 の追記を参照。境界器官の走り方は `/new` と同一）
- 記帳・知覚・Tomoの質問・鏡・分割プロトコルといった器官はすべて本体のもの。
  GUIはそれらを**再実装せず、透過させる**

## Decision 2: 会話の経路 = `tomobit chat` 子プロセス（pipe mode）

GUIバックエンドは `tomobit chat` をパイプ接続の子プロセスとして起動する。
非TTYのchatは「1行 = 1ターン」で動く既存経路（ADR-0022 Decision 3。
テストとスクリプトが通るのと同じ道）であり、GUIはその三人目の利用者になる。

- stdinへターンを書き、stdout/stderrをストリームのままチャット面に流す
- `/new`・`/exit` もそのまま流す → 区切りの尾部（Feedback→知覚→質問→鏡）が
  本体の実装で走る
- CLI子プロセス＋ストリーム配管は、本体がExecutorに対して取っている姿勢
  （ADR-0004）と同じ形である

却下した対案:

- **Anthropic API直結** → chat→台帳の器官一式を再実装する二重帳簿。
  詳細は [ADR-0002](ADR-0002-tech-stack.md) Decision 3
- **本体をライブラリとしてimport** → `internal/` はモジュール境界で閉じており、
  開けるには本体の公開API化という大工事が要る。リポジトリを分ける判断とも噛み合わない
- **1ターンごとに `tomobit do`** → 1ターン=1セッションになり台帳が嘘をつく。
  ADR-0022が同じ理由で却下済み

既知の摩擦（受け入れる）: pipe出力は端末向けの素テキストで、ターン終端の
機械可読なフレーミングがない。v1はストリーム表示とし、入力は常時受け付ける
（chatは行を順に読むので、先行入力は次ターンとして処理される — 端末と同じ挙動）。
構造化チャネル（例: NDJSONのviewストリーム）が欲しくなったら、
それは本体側の拡張ADRの論点であり、GUI側でパース職人芸を積まない。

### 追記（2026-07-20・本体 ADR-0032 の採用）

上の「既知の摩擦」と Decision 4 の1行=1ターン前提が、本体
[ADR-0032](https://github.com/Rererr/tomobit/blob/main/docs/decisions/ADR-0032-pipe-chat-first-class.md)
で解消された。GUIは以下を配線する（パース職人芸は積まないまま、契約に乗る）:

- **ストリーム表示 → 構造化表示**（ADR-0032 Decision 1）: `tomobit chat --view ndjson` で
  起動し、stdout の全量 NDJSON を行フレーミング＋JSONデコードして `chat:view` で流す。
  ターン枠・本文ブロック・ツール行・器官の発話（note）を型で判別する。未知 type は無視
  （契約: 消費者は未知の type を無視せよ）。stderr は契約外の診断として従来どおりチャンク中継
- **複数行入力**（ADR-0032 Decision 2）: 改行を潰していた flattenTurnLine を、末尾 `\`
  行継続への encodeTurn に置き換える。意味論は本体 lineedit readCooked に正確に合わせる

## Decision 3: メモリ管理はSQLite読み取り専用のView

顔窓と同じ姿勢（ADR-0020 Decision 2: `mode=ro` で開き、Viewを導出して見せるだけ）。

- 見せるもの: connections（Tomoの理解）・experiences（積んだ経験）・
  curiosity_queue（気になっていること）
- 書かない。「メモリ削除」はv1に入れない — 経験主権（ADR-0018）はユーザーにあるが、
  experiencesの削除はrebuild整合（射影の再構築）と一体で設計する必要があり、
  GUIから直接DELETEする軽い操作ではない。必要になったら本体側のADRで
  「忘却の器官」として設計する（Open Question）

### 追記（2026-07-19・実装時判断の充填 — 編集・削除の配線）

本体 ADR-0033（忘却の器官）の確定を受け、Open Question を解いて書き込みを配線した。
読みは mode=ro のまま — GUIは今もDBに書かない:

- **口 = CLIサブプロセス**（`forget.go`）: `tomobit forget --id <id> --yes` /
  `tomobit amend --id <id> [--context] [--outcome] [--provider]`。stdout の1行サマリを
  成功表示に、stderr を通知・エラー文言としてそのまま画面へ運ぶ。JSON・context key・
  provider の検証は本体CLIが唯一の検証者 — GUIで再実装すると本体の閉集合
  （SCHEMA.md R2/R3）とドリフトする
- **確認ゲートは画面側**: 非TTYで必須の `--yes` を常に付け（ADR-0033 Decision 2 の
  予定どおり）、不可逆の確認は MemoryPane の行内二段確認
  （「物理削除する — 取り消せない」）が担う
- **amend の「省略=保持」**: AmendRequest の Set* フラグが「置き換える」を「触らない」
  から言い分け、未編集の項目はフラグごと省略して本体の「フラグ省略=保持」に乗せる。
  編集フォームは raw JSON の全置換 — プリティ整形や項目分解のUIは持たない
  （検証者を増やさない、の裏面）
- **実装しない判断**: `forget --session`（生ログごと消す完全忘却）の口はGUIに
  持たない。メモリViewの主対象は経験行であり、セッション単位の外科手術は
  子セッション残置の判断を伴う一段重い操作 — CLI直の明示操作に残す。
  必要になったらセッション一覧側の設計として起こす
- **既知の摩擦（実測・本体側の論点）**: amend で世代が積まれた (session, kind) の
  現行世代だけを forget すると、旧世代が現行として再浮上する（e2e で観測 —
  BACKLOG 参照）。view は experiences_current の真実を映すので GUI は嘘をつかないが、
  「忘れたつもり」の意味論は本体 ADR-0033 側で決める話で、GUIは先取りしない

## Decision 4: 好みの喋り方 = Provider起動引数への注入

喋り方の指示はプロンプトに前置しない。intentはユーザーの言葉のまま記帳される
べきで、毎ターンの前置は台帳（とダイジェスト経由の知覚）を汚す。

- 口は既存の `TOMOBIT_CLAUDE_ARGS` / config `claude_args`（claude起動に毎回
  引数を足す既存機構）に `--append-system-prompt` を載せる。システムプロンプトは
  記帳されないため台帳は汚れない
- 制約: 現行の env 経路は空白区切り（`strings.Fields`）で、空白を含む文が
  渡らない。実装時に (a) 本体の env パースを shellwords 対応にする
  (b) GUIがconfig経由で渡す — のどちらかを決める（クロスリポジトリの小改修候補）
- GUI自体の設定（喋り方テキスト・表示ノブ）は `~/.tomobit/gui.json`。
  これは配線であって経験ではない（ADR-0021と同じ位置づけ）

### 追記（2026-07-19・実装時判断の充填）

- **注入経路 = 本体に env `TOMOBIT_CLAUDE_ARGS_APPEND` を新設**（クロスリポジトリ小改修）。
  実装時に判明した事実: env `TOMOBIT_CLAUDE_ARGS` は config `claude_args` を
  **完全置換**する（env > config は追記ではない）。実機の config には
  `--exclude-dynamic-system-prompt-sections` が実在し、GUIが既存 env を使うとこれが落ちる。
  - 却下 (a) 既存 env の引用符対応だけ → 置換問題が残る
  - 却下 (b) config `claude_args` への書き込み → `claude_args` は `do` の Executor 起動を
    含む全 claude 起動に効き、喋り方が端末セッションとタスク実行へ漏れる
  - 採用: env>config で解決した引数列の**後ろに追記**される新 env。パースは引用符対応
    （`TOMOBIT_CLAUDE_ARGS` も同じパーサに揃える — 引用符なし入力の挙動は従来と同一）。
    GUIは chat 子プロセスの env にだけ `--append-system-prompt <喋り方>` を載せるので、
    効くのはGUI発のセッションのみ・既存引数はそのまま・台帳も汚れない
- **反映境界 = セッション境界 = プロセス境界**。env はプロセス起動時に固定されるため、
  GUIの「New chat」は `/new` でなく **`/exit` を送り、次の送信が新プロセスを起動する**
  （既存の自動再起動に乗る）。pipe では起動時挨拶が無く（isTTY ゲート）、境界器官は
  `/new` と同じ `closeTask` で走るので、意味は「区切りの宣言」のまま変わらない。
  受け入れる摩擦: `/exit` 後〜プロセス終了までの間に送った行は読まれずに落ちる
  （端末で `/exit` 直後に打った文字と同じ運命）。終了後の送信は既存の
  EPIPE 再起動・再送が拾う

## Decision 5: 姿は顔窓のまま。GUIは姿を再実装しない

- スプライト資産と姿の描画は `tomobit-face`（Ebiten窓）が唯一の正本のまま
- pipe起動では顔窓自動起動のTTYゲートが立たないため、GUIが `TOMOBIT_FACE=1` を
  立てて子プロセスを起動する（GUI設定でOFF可）。顔窓はGUIの隣に浮かぶ
- GUIヘッダの `Tomo · <ステージ名>` などテキストのViewは導出してよい
  （ADR-0025のテキストフォールバックと同じ位置づけ）

### 追記（2026-07-20・本体 ADR-0032 の採用）

「pipe起動ではTTYゲートで死に配線」という見送り理由が、本体
[ADR-0032](https://github.com/Rererr/tomobit/blob/main/docs/decisions/ADR-0032-pipe-chat-first-class.md)
Decision 3 で解消された。TTYゲートが「env 沈黙時の既定」に改まり、`TOMOBIT_FACE=1`
の明示は TTY を問わず窓を開く（presence も同条件で登録され、pipe起点の窓が寿命規律に
接地する）。GUIは chat 子プロセスの env に `TOMOBIT_FACE=1` を立てる — ただし親環境が
既に `TOMOBIT_FACE` を明示していれば触らない（ユーザーの `=0` を GUI が黙って覆すのは
env>config の序列に反する。`chat.go` composeChatEnv）。

### 追記（2026-07-24・「GUI設定でOFF可」の実装時判断）

顔窓トグルは `gui.json` の `face_enabled` に持つ。**未設定=ON**（現行挙動の維持）と
明示OFFを区別するため tri-state（`*bool`）。OFF の表現は `TOMOBIT_FACE=0` を
書くのではなく**沈黙** — 本体 ADR-0032 Decision 3 の「env 沈黙時の既定は
TTYゲート」に委ねる（pipe では沈黙=開かない）。親環境が `TOMOBIT_FACE` を
明示していれば GUI 設定より優先される（env>config の序列は上の追記と同じ）。

### 追記（2026-07-24・本体 ADR-0039 の採用によるステージ導出の返上）

「テキストのViewは導出してよい」の但し書きで持っていたステージ導出の移植
（stage.go 約570行 — 本体の Beta 数学・較正ノブの複製）は、本体
[ADR-0039](https://github.com/Rererr/tomobit/blob/main/docs/decisions/ADR-0039-status-machine-view.md)
の `tomobit status --view json` に置き換えた。ヘッダの真実は台帳を書く
バイナリ自身が導出し、GUIは器官の口（Decision 3 と同じサブプロセス型）で
読むだけになる — 較正ノブへの追随義務と opt-in 照合テストは役目を終えた。
旧本体（`--view` を知らない版）ではヘッダ取得が失敗し、素の「Tomo」表示に落ちる。

### 追記（2026-07-25・GUI にも姿が立つ — ただし正本は増えない）

「GUIは姿を再実装しない」は維持したまま、GUI のサイドバーにも Tomo が立つ
（[ADR-0006](ADR-0006-sidebar-standing-views.md) Decision 2）。実際の使用で
顔窓が他の窓の裏に回り、チャットの隣に相棒が居ないという実害が出たため。

この Decision が禁じていたのは**姿の再実装**であって、姿の表示ではなかった。
資産を書き写す道は本体
[ADR-0048](https://github.com/Rererr/tomobit/blob/main/docs/decisions/ADR-0048-sprite-machine-view.md)
が塞ぎ、代わりに `tomobit-face --view json` が格子・パレット・気分記号の座・
アニメのノブを配るようになった。ステージ導出を ADR-0039 へ返上したのと同じ型で、
**GUI はデコードして描くだけ** — スプライトを1バイトも持たない。

顔窓は今までどおり並行して開く（`face_enabled`）。増えたのはレンダラであって、
正本ではない。旧顔窓（`--view` を知らない版）では取得が失敗し、Tomo セクションは
黙って出ない（ヘッダが素の「Tomo」に落ちるのと同じ劣化の作法）。

---

## Consequences

- GUIの会話も端末と同じ台帳に積まれ、Tomoは入口によらず同じ速度で育つ。
  `tomobit rebuild` すればGUIから積んだ経験も同じに再生される
- GUIはtomobitバイナリ（PATH上の `tomobit`）に依存する。同一マシン・同一
  ユーザーの前提であり、Sovereignty（ローカル完結）は破らない
- 過去セッションの完全な会話ログは台帳から再構成**できない**（eventsが持つのは
  知覚用ダイジェストで、全文ではない）。v1のチャット面はライブセッションを正とし、
  過去分はダイジェストからの要約表示に留める。全文の表示専用キャッシュを
  持つかはOpen Question（持つ場合も真実はeventsのまま）
- 実装順: 雛形（起動する骨格）→ chat子プロセス配線 → 喋り方設定 → メモリView
