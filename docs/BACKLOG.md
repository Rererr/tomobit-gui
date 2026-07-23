# Backlog — 残課題

実環境の通し検証（2026-07-19: 実LLM APIでの会話・喋り方設定の反映・
経験の記帳とメモリViewへの反映・主観Feedback(1=文句なし)の outcome 反映まで一連PASS）
の時点で残っている課題。設計上の根拠は各ADRを参照。

## 本体 ADR-0032 で解決（2026-07-20 実装）

3件は本体 [ADR-0032](https://github.com/Rererr/tomobit/blob/main/docs/decisions/ADR-0032-pipe-chat-first-class.md)
（pipe chat の一級市民化 — view ストリーム・行継続・顔窓オプトイン）で解決済み。

- **ターン終端の機械可読フレーミング** → 本体 ADR-0032 Decision 1。`tomobit chat --view ndjson`
  で stdout が全量 NDJSON の view ストリームになる。GUIは行フレーミング＋JSONデコードで
  `chat:view` として流し（`chat.go` pumpViewStream）、フロントは構造化表示に置き換えた
  （`App.tsx` handleViewEvent / `ChatPane.tsx`）。パース職人芸は積まない — 未知 type は
  無視する契約
- **複数行入力** → 本体 ADR-0032 Decision 2。cooked mode に末尾 `\` 行継続が生えた。
  改行を潰す flattenTurnLine を継続化エンコーダ encodeTurn に置き換え（`chat.go`）、
  フロントは改行を保持したまま送る（`App.tsx` handleSend）
- **顔窓のGUI起動** → 本体 ADR-0032 Decision 3。TTYゲートが「env 沈黙時の既定」に
  改まり、`TOMOBIT_FACE=1` の明示が pipe でも窓を開く。GUIは子 env に =1 を立てる
  （親が明示済みなら尊重して触らない — `chat.go` composeChatEnv）

## 本体 ADR-0034 で解決（2026-07-21）

- **忘れた経験の世代再浮上**（実測 2026-07-19、GUI e2e で観測: 人が訂正→忘却した
  経験の機械知覚版が戻った）→ 本体
  [ADR-0034](https://github.com/Rererr/tomobit/blob/main/docs/decisions/ADR-0034-forgetting-reach.md)。
  `forget --id` は現行世代の行のみを受理し、同じ (session, kind) の下位世代も
  併せて削除するようになった（削除後に max(extractor_ver) が下がる経路が構造的に消えた）。
  巻き添え行数は 1行サマリに `+N superseded rows` として出る。
  **GUI 側の変更は不要** — メモリViewは experiences_current を映すので、
  View から辿れる id は常に現行世代である（ADR-0034 Consequences）。
  BACKLOG が挙げた対案のうち「(session, kind, ts) 単位のカスケード」は
  ADR-0034 で却下されている（kind=preference は同一 ts の行が複数生えうるため
  系譜キーとして単射でない）

- **境界の器官が GUI でも発火する**（本体
  [ADR-0035](https://github.com/Rererr/tomobit/blob/main/docs/decisions/ADR-0035-boundary-organs-reach-the-pipe.md)）:
  Tomo の質問（ADR-0007）と鏡（ADR-0015）は `isTTY(os.Stdin)` ゲートで閉じており、
  pipe で chat を飼う GUI では構造上一度も発火していなかった（Feedback だけが届いていた）。
  対人の信号が `--view ndjson` になり、両器官も `{"type":"note",...,"await":true}` として届く。
  **GUI 側の配線変更は不要** — Feedback の質問を既に同じ形で受けている

## 本体 ADR-0039 で解決（2026-07-24）

- **ステージ導出式の共有** → 本体
  [ADR-0039](https://github.com/Rererr/tomobit/blob/main/docs/decisions/ADR-0039-status-machine-view.md)
  （相棒ビューの機械可読view）。`tomobit status --view json` が stage/mood/speak を
  1オブジェクトで返し、GUI は移植570行を捨ててサブプロセスで読む
  （ADR-0001 Decision 5 の追記を参照）。較正ノブの追随義務・照合テストは消滅。
  **前提**: 本体はADR-0039実装済みの版（2026-07-24以降）が必要。旧本体では
  ヘッダが素の「Tomo」に落ちる（機能degrade、クラッシュはしない）

GUI側の未実装 3件（Tomo名ヘッダ / セッション一覧のダイジェスト要約 /
connections の Provider 単位集約）は 2026-07-19 に実装済み。
メモリの編集・削除（本体「忘却の器官」ADR-0033 経由の `tomobit forget --id` /
`tomobit amend` サブプロセス配線）も 2026-07-19 に実装済み — 実装時判断は
ADR-0001 Decision 3 の追記を参照。`forget --session`（生ログごと消す完全忘却）の
口は GUI に持たない判断（同追記）。
