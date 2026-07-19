# Backlog — 残課題

実環境の通し検証（2026-07-19: 実LLM APIでの会話・喋り方設定の反映・
経験の記帳とメモリViewへの反映・主観Feedback(1=文句なし)の outcome 反映まで一連PASS）
の時点で残っている課題。設計上の根拠は各ADRを参照。

## 本体側の設計待ち（GUI単独では進められない）

- **顔窓のGUI起動**（ADR-0001 Decision 5）: pipe起動では本体のTTYゲートが顔窓の
  自動起動を打ち切るため、`TOMOBIT_FACE=1` を立てても死に配線になる。本体側が
  pipe=窓なし前提（本体ADR-0025）を設計し直すまで見送り
  （`chat.go` ensureProcLocked のコメント参照）
- **メモリの編集・削除**（ADR-0001 Decision 3 Open Question）: experiences の削除は
  rebuild整合（射影の再構築）と一体で設計する必要があり、本体側の「忘却の器官」
  ADRを待つ。それまでViewは読み取り専用
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

GUI側の未実装 3件（Tomo名ヘッダ / セッション一覧のダイジェスト要約 /
connections の Provider 単位集約）は 2026-07-19 に実装済み。
