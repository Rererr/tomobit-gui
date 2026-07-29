# Contributing to tomobit-gui

日本語でも英語でも構いません。

**方針は本体 [tomobit](https://github.com/Rererr/tomobit) と同じです** —
[本体のCONTRIBUTING.md](https://github.com/Rererr/tomobit/blob/main/CONTRIBUTING.md) を
先に読んでください。要点だけ再掲します。

- **CLAは採りません。** [DCO 1.1](https://developercertificate.org/) を使います。
  コミットに `Signed-off-by:` を付けてください（`git commit -s`）
- コード → [AGPL-3.0-only](LICENSE) / 文書 → [CC BY-SA 4.0](LICENSE-docs)
- 挙動・設計に関わる変更は、コードより先にADRのドラフトを出してください

## ADRの書き方

節ラベルと改版マークの規約は本体と共通です
（[tomobit CONTRIBUTING.md](https://github.com/Rererr/tomobit/blob/main/CONTRIBUTING.md)）。
要点だけ:

- `## 実装フェーズ（Proposed）` は**起草時に提案した計画**。実際に起きたことは
  `## 実装の記録（日付）` / `## 追記（日付）` が持ちます。Status が「実装済み」でも
  計画の節を結果で上書きしないでください
- 決定を覆すときは、**覆す側**のヘッダに `- 改版: ADR-0004 D1 D2` の1行を書きます。
  被改版側の冒頭に立つ「改版済み」ブロックは `make docs-sync` が生成します
  （手で書かない）。`make docs-check` が陳腐化を検出します
- 本体のADRを改版する場合は、このスクリプトが隣のリポジトリを書き換えられないので
  宣言は書かず、散文と `関連:` で書きます

## このリポジトリ固有の原則

GUIは**第三のレンダラ**であって、新しい真実を作りません
（[ADR-0001](docs/decisions/ADR-0001-gui-architecture.md)）。PRを出す前に:

1. **台帳に書かない。** 会話は `tomobit chat --view ndjson` を透過して本体が記帳します。
   GUIが直接 `~/.tomobit/tomobit.db` へ書く変更は入りません（読み取りViewは可）
2. **語彙を持たない。** 選択肢・文言は本体のviewストリームから読むこと
   （[ADR-0005](docs/decisions/ADR-0005-closing-boundary.md)）。
   GUI側に文言を焼き込むと、本体と二重資産になります
3. **導出式を移植しない。** stage も姿も本体の `--view json` を購読します
   （[ADR-0006](docs/decisions/ADR-0006-sidebar-standing-views.md)、本体ADR-0039/0048）。
   移植は過去に570行の負債になり、捨てました

## 検証

```bash
gofmt -l .        # 出力が空であること
go vet ./...
go test ./...
make docs-check   # ADRリンクの参照先が実在すること・改版マークが最新であること
cd frontend && npm test && npx tsc --noEmit
```

ドキュメントだけの変更でも `make docs-check` は通してください。ADRの
`関連:` ブロックは参照先の表題の記憶から書かれがちで、ファイル名とずれても
人間の目には読めてしまいます。

本体 tomobit を隣（このリポジトリの親ディレクトリ）に置いていれば、本体の
ADRを指すURLの参照先も見ます。置いていなければその分は検査せず、何本見な
かったかを言います。探す場所は `ADR_LINK_SIBLINGS` で変えられます。

実GUIの通し検証の手順は [.claude/skills/verify/SKILL.md](.claude/skills/verify/SKILL.md) に
あります。**実台帳を検証に使わないでください** — 実会話がログやスクリーンショットに写ります。

## 報告

- バグ・要望 → [Issues](https://github.com/Rererr/tomobit-gui/issues)
- 脆弱性 → **公開Issueではなく** [SECURITY.md](SECURITY.md) の手順で
