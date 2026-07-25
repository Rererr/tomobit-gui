<!--
挙動・設計に関わる変更は、コードより先にADRのドラフトを（CONTRIBUTING.md）。
-->

## 何を変えるか

## なぜ

## 関連するADR

<!-- 本体側のADRに従う変更なら、そのリンクを -->

---

- [ ] `gofmt -l .` が空 / `go vet ./...` / `go test ./...` が通る
- [ ] `npm test` と `npx tsc --noEmit` が通る
- [ ] 台帳へ直接書いていない（書くのは本体だけ — ADR-0001）
- [ ] GUI側に文言・導出式を焼き込んでいない（本体のviewから読む）
- [ ] コミットに `Signed-off-by:` がある（`git commit -s` / DCO。**CLAはありません**）
