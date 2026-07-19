# Backlog — 残課題

実環境の通し検証（2026-07-19: 実LLM APIでの会話・喋り方設定の反映・
経験の記帳とメモリViewへの反映・主観Feedback(1=文句なし)の outcome 反映まで一連PASS）
の時点で残っている課題。設計上の根拠は各ADRを参照。

## 本体側の設計待ち（GUI単独では進められない）

- **顔窓のGUI起動**（ADR-0001 Decision 5）: pipe起動では本体のTTYゲートが顔窓の
  自動起動を打ち切るため、`TOMOBIT_FACE=1` を立てても死に配線になる。本体側が
  pipe=窓なし前提（本体ADR-0025）を設計し直すまで見送り
  （`chat.go` ensureProcLocked のコメント参照）
- **複数行入力**: pipe mode は1行=1ターンで行継続の構文が無く、GUIは改行をスペースに
  潰して送っている（`chat.go` flattenTurnLine）。本体 cooked mode に継続構文が
  生えたら外す
- **ターン終端の機械可読フレーミング**（ADR-0001 既知の摩擦）: pipe出力は端末向けの
  素テキストで、Tomo吹き出しの区切りはユーザー送信のみ。構造化チャネル
  （NDJSON viewストリーム等）は本体側の拡張ADRの論点 — GUI側でパース職人芸は積まない
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
