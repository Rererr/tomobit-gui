# ADR-0003: 過去セッションの表示 — スクロールバックの永続化

- Status: **Proposed**（2026-07-24 起草。所有者の採否待ち — 実装はしていない）
- Date: 2026-07-24
- 関連: [ADR-0001](ADR-0001-gui-architecture.md)（Consequences の Open Question「全文の
  表示専用キャッシュを持つか」/ Decision 2: GUIは新しい真実を作らない）,
  本体 [ADR-0018](https://github.com/Rererr/tomobit/blob/main/docs/decisions/ADR-0018-experience-sovereignty.md)（経験主権）,
  本体 [ADR-0033](https://github.com/Rererr/tomobit/blob/main/docs/decisions/ADR-0033-forgetting-organ.md)/[ADR-0034](https://github.com/Rererr/tomobit/blob/main/docs/decisions/ADR-0034-forgetting-reach.md)（忘却の到達範囲）

---

## Context

過去セッションはダイジェスト要約しか見えない（ADR-0001 Consequences が明記した
既知の制約）。台帳の events が持つのは知覚用ダイジェストで全文ではなく、
本体 `~/.tomobit/sessions/` にあるのは presence ロックだけ — 会話の全文は
view ストリームとして GUI を**通過した瞬間にしか存在しない**。

端末のレンダラはこの問題を持たない。スクロールバックが自然に全文を保持する
からである（本体 ADR-0022 が bubbletea を却下した理由も「alt screen が
スクロールバックを奪う」だった — 全文が遡れることは端末では守られた価値）。
GUI はプロセスを再起動するとスクロールバックを失う。**端末より劣るレンダラ**に
なっている点が、チャットの器としての決定的なギャップである。

## Decision（提案）

### Decision 1: GUI は自分が描画した view ストリームをそのまま永続する

- 保存単位は 1 セッション 1 ファイル（`~/.tomobit/gui-scrollback/<sid>.ndjson`）。
  中身は chat:view で受けた NDJSON イベントの素通し追記 — **再解釈も要約もしない**
- これは「第二の台帳」ではない。端末が持つスクロールバックの GUI 版であり、
  位置づけは表示キャッシュ（ADR-0001 Decision 2 の「新しい真実を作らない」は
  破らない — 真実は今後も events。 スクロールバックから知覚も記帳も生まれない）
- 過去セッションを開いたとき、スクロールバックがあれば全文（ライブと同じ
  構造化描画）、無ければ現行どおりダイジェスト要約へフォールバック

### Decision 2: 忘却より長生きしない

忘却（本体 ADR-0033/0034）が台帳から消したものを、GUI の隅で生き残らせては
ならない。スクロールバックが忘却の器官の到達範囲外に漏れるなら、それは
ADR-0034 が塞いだ「忘れた経験の再浮上」の GUI 版になる。

- 過去セッションを開く前に sid を台帳へ照会し、セッションが消えていれば
  スクロールバックも削除してから「無い」と答える（読み込み時検証）
- `forget --session` の口を GUI が持たない判断（ADR-0001 Decision 3 追記）は
  変えない — 端末で忘れられたものを GUI が次回開くときに追随して消す

### Decision 3: 保持は無制限にしない

素通し追記は tool_result を含み、1セッションで数百KBになりうる。上限
（例: 直近Nセッション or 総量MB）を持ち、超過分は古い順に削除して
ダイジェスト表示へ落とす。**削除は劣化であって喪失ではない** —
経験（台帳）は残っている。ノブの較正は実運用の実測で決める。

## 却下した対案

- **本体の events に全文を積む** → 台帳は Experience の器（本体 SCHEMA.md）。
  表示のための本文を真実の器に混ぜると、忘却・rebuild・知覚の全てが
  「表示キャッシュの重さ」を背負う。器官の責務が濁る
- **Provider 側の透明性に頼る**（claude CLI のセッションファイル等）→
  Provider 固有形式への依存で、Executor 抽象（本体 ADR-0006）を表示が破る。
  Provider を替えたら過去が読めなくなるのは Experience Sovereignty の精神に反する
- **何もしない** → 「チャットの器」を名乗る GUI が端末のスクロールバックに
  劣ったまま。$50/月の判断軸では、過去の会話が読めないチャット製品は
  それだけで脱落しうる

## Consequences

- GUI: chat.go の pumpViewStream に追記フック（数十行）、SessionPane の
  全文描画分岐、読み込み時検証、上限管理。フロントは既存の ChatPane 描画を
  過去表示に再利用できる（ライブと同じイベント列だから）
- 機微情報がプレーンテキストで `~/.tomobit/` 配下に増える。台帳と同じ
  ディレクトリ・同じ所有者権限（0600）に置く — 経験主権の境界の内側
- 本体変更は不要（view ストリームは既に全量を運んでいる — 本体 ADR-0032/0040）
