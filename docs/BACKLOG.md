# Backlog — 残課題

実環境の通し検証（2026-07-19: 実LLM APIでの会話・喋り方設定の反映・
経験の記帳とメモリViewへの反映・主観Feedback(1=文句なし)の outcome 反映まで一連PASS）
の時点で残っている課題。設計上の根拠は各ADRを参照。

## 未解決: 走行中に送った1行が、権限の問いの答えとして飲まれる（2026-08-01 発見）

本体のチャットは**1本の stdin を順に読む**。走行中に届いた行はパイプに溜まり、
次に本体が行を読む場所で消費される —— その場所は必ずしも入力プロンプトではない:

```text
Tomoが走行中 → 人が入力欄から次の一言を送る → パイプに溜まる
            → Provider が道具の許可を求める（本体 ADR-0053: c.in.ReadString）
            → 溜まっていた一言が**許可の答えとして読まれる**
            → "1" ではないので拒否。人の一言も許可も、両方が消える
```

境界の器官（Feedback・好奇心・鏡）も同じ形で行を読む。

- **反応（ADR-0014 Decision 4）の側は塞いだ**: 口が空くまで溜めて送る。
  押す頻度が上がる器官なので先に塞いだ
- **入力欄の側は塞いでいない。** ADR-0014 Decision 4 が反応に採った「溜めて流す」を
  入力欄にも当てるのか、それとも権限の問いが立っている間は送信を差し止めるのか
  （＝人が答えるべき問いが画面に出ているのだから、そちらを先に答えさせる）は、
  会話の入口の摩擦に関わるので設計を要する
- **反応と入力欄の「同時送信」も同じ穴である**（レビューで指摘）。反応の側は自分の
  再入だけを直列化したが、`SendLine` を無条件に呼べる送信元がもう1つある以上、
  口が空いた瞬間に両方が飛ぶ経路は残っている（Go 側 `writeMu` はバイト列の破損は
  防ぐが、**どちらが先に書かれるかは決めない**）。塞ぐなら
  **`SendLine` の呼び出し口を1本のキューへ集約する**のが素直で、反応側の
  「溜めて流す」はその特別扱いをやめてキューに乗るだけになる
- **実機での再現は未確認**（実装を読んだ限りの構造。外部レビューでも同じ経路が
  P1 として指摘された）。再現手順を先に作るのが順序として正しい

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
