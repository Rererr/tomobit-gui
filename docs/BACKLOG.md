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

## 本体側の設計待ち（GUI単独では進められない）

- **ステージ導出式の共有**: Tomo名ヘッダ（2026-07-19 実装）は本体
  `internal/face/stage.go` とその依存の移植（tomobit d4e2412 時点、`stage.go`）で
  導出している。本体の較正ノブ・式の変更には追随が要る（ドリフト検知は
  `stage_test.go` の opt-in 照合テストによる手動確認のみ）。恒久解
  （本体の公開API化 or viewストリームへの stage 掲載）は本体側ADRの論点

- **忘れた経験の世代再浮上**（実測 2026-07-19）: 本体 `forget --id` は指名行のみを
  消すため、amend で世代が積まれた (session, kind) の現行世代だけを忘れると、
  旧世代が experiences_current の現行として再浮上する（GUI e2e で観測:
  人が訂正→忘却した経験の機械知覚版が戻った。`memory_e2e_test.go` の観測ログ）。
  view は真実を映すので GUI は正直だが、「忘れたつもり」を作る本体側の論点 —
  系譜（session, kind, ts は世代間で保持される）単位のカスケード削除か、
  ADR-0033 への意味の明文化が要る。GUI はこの判断を先取りしない

GUI側の未実装 3件（Tomo名ヘッダ / セッション一覧のダイジェスト要約 /
connections の Provider 単位集約）は 2026-07-19 に実装済み。
メモリの編集・削除（本体「忘却の器官」ADR-0033 経由の `tomobit forget --id` /
`tomobit amend` サブプロセス配線）も 2026-07-19 に実装済み — 実装時判断は
ADR-0001 Decision 3 の追記を参照。`forget --session`（生ログごと消す完全忘却）の
口は GUI に持たない判断（同追記）。
