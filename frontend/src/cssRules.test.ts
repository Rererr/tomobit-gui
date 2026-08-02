import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { declarationsFor, parseCssRules, rulesFor } from "./cssRules.ts";

const css = readFileSync(fileURLToPath(new URL("./App.css", import.meta.url)), "utf8");

// --- 読み手そのもの（間違った値を静かに読まないこと） ---

test("素直なルールだけを読む", () => {
  const rules = parseCssRules(".a, .b { color: red; border: 1px solid #fff; }");
  assert.deepEqual(rules, [
    { selectors: [".a", ".b"], declarations: { color: "red", border: "1px solid #fff" } },
  ]);
});

test("コメントの中の括弧に釣られない", () => {
  // App.css には日本語の長いコメントが在り、その中に { } が入ることがある。
  const rules = parseCssRules("/* .x { color: blue; } */ .y { color: red; }");
  assert.deepEqual(rules.map((r) => r.selectors), [[".y"]]);
});

test("同じセレクタが2回書かれていたら後が勝つ", () => {
  const merged = declarationsFor(".a { color: red; } .a { color: blue; }", ".a");
  assert.equal(merged.color, "blue");
});

// --- 送信待ちの姿 (ADR-0014 Decision 4) ---

test("送信待ちは filter で薄くしない — 輪郭のコントラストごと落ちるから", () => {
  // filter: opacity(0.55) は要素全体を減衰させるので、border(#736c62) の実効色は
  // 地へ 55% 混ざった #4b4741 = 1.89:1 になり、WCAG 1.4.11 の 3:1 を大きく割る
  // （contrast.ts の式で実測）。filter の結果はテストから見えないので、
  // 輪郭と文字は別々のプロパティで書く（そうすれば contrast.test.ts が守れる）。
  for (const rule of rulesFor(css, ".chat-reaction-btn--waiting")) {
    assert.equal(rule.declarations.filter, undefined, "filter で薄くすると輪郭の色まで薄まる");
    // opacity:1（＝ホバー無しでも見せる）は別の意味なので許す。薄さの表現には使わない。
    assert.ok(
      rule.declarations.opacity === undefined || rule.declarations.opacity === "1",
      "薄さを opacity で表すと、ホバー中に待ちの姿が消える",
    );
  }
  const waiting = declarationsFor(css, ".chat-reaction-btn--waiting");
  assert.equal(waiting["border-style"], "dashed", "確定した印（実線）と見分ける");
  assert.equal(
    waiting["border-color"],
    "var(--color-border)",
    "基底の border-color は transparent — 明示しないと破線が1本も描かれない",
  );
  assert.equal(waiting.color, "var(--color-text-muted-aa)", "文字は文字のプロパティで薄くする");
});

// --- フォーカスの輪郭 (WCAG 1.4.11) ---

test("既定では輪郭を持たない部品に、フォーカスの輪郭を自分で当てる", () => {
  // Chromium 既定のリング rgb(0,95,204) は地に対して 2.91:1 で 3:1 未達。
  // --color-focus は 6.76:1（contrast.test.ts が実測している）。
  for (const selector of [
    ".chat-reaction-btn:focus-visible",
    ".chat-turn-meta > summary:focus-visible",
    ".chat-turn-decided > summary:focus-visible",
    ".chat-turn-tool-result > summary:focus-visible",
  ]) {
    const d = declarationsFor(css, selector);
    assert.equal(d.outline, "2px solid var(--color-focus)", `${selector} に輪郭が無い`);
    assert.equal(d["outline-offset"], "2px", `${selector} の輪郭が部品に貼り付いている`);
  }
});

// --- 反応の口の発見可能性 (ADR-0014 実装時ノブ) ---

test("会話の最後のターンだけは、ホバー無しでも反応の口が見える — 見るのは isLatestTurn が付けた印であって DOM の最後の子要素ではない", () => {
  // ホバーでしか現れないものは一度も気づかれない可能性があり、気づかれなければ
  // 「締めが軽くなる」という設計意図ごと発火しない。
  //
  // `.chat-log > :last-child` ではなく `.chat-turn-reactions--latest` を見る:
  // 会話の末尾にはターンの後に note（境界の器官の発話）・system・stderr・
  // 走行中の帯が来うるので、DOM 上の最後の子要素は「最後のターン」だとは
  // 限らない。「最後のターン」の判定は isLatestTurn（reaction.ts）に集約して
  // あり、CSS 側はその結果が落ちた1クラスだけを見る。
  const shown = rulesFor(css, ".chat-turn-reactions--latest .chat-reaction-btn");
  assert.equal(shown.length, 1, "最後のターンを見せる規則が無い");
  assert.equal(shown[0].declarations.opacity, "1");
  // ホバー・フォーカス・置かれた印と同じ1つの規則に相乗りしている（状態を増やさない）。
  assert.ok(shown[0].selectors.includes(".chat-message:hover .chat-reaction-btn"));
});

// --- 入力欄までの飛び石 (WCAG 2.4.1) ---

test("入力欄へのスキップリンクは、フォーカスが来た時だけ実体を持つ", () => {
  const hidden = declarationsFor(css, ".chat-skip-to-input");
  assert.equal(hidden.position, "absolute");
  assert.equal(hidden.width, "1px", "普段は読み上げにだけ在る");
  assert.equal(hidden.clip, "rect(0, 0, 0, 0)");
  const focused = declarationsFor(css, ".chat-skip-to-input:focus");
  assert.equal(focused.width, "auto", "フォーカスが来ても見えないなら、目で使う人には存在しない");
  assert.equal(focused.clip, "auto");
  assert.equal(focused.outline, "2px solid var(--color-focus)");
});

// --- メタ行の左端 (開閉できるかどうかで動かさない) ---

test("メタ行の左端は、開ける行でも開けない行でも同じ位置から始まる", () => {
  // UA の三角マーカーは幅が engine 依存（macOS の実機は WKWebView、検証は
  // Chromium）。マーカーごと自前のものへ置き換え、bare な行には同じ幅を空ける。
  const summary = declarationsFor(css, ".chat-turn-meta > summary");
  assert.equal(summary["list-style"], "none", "UA マーカーが残ると幅が engine 依存になる");
  assert.equal(
    declarationsFor(css, ".chat-turn-meta > summary::-webkit-details-marker").display,
    "none",
    "WebKit のマーカーは list-style では消えない",
  );
  const marker = declarationsFor(css, ".chat-turn-meta > summary::before");
  const bare = declarationsFor(css, ".chat-turn-meta--bare::before");
  assert.equal(marker.width, "var(--meta-marker-width)");
  assert.equal(bare.width, marker.width, "開けない行が三角のぶんだけ左へずれる");
  assert.equal(bare.content, '""', "機能しない矢印は出さない（場所だけ空ける）");
});

// --- 引用と注記を混ぜない (ADR-0014 の趣旨そのもの) ---

test("Tomo の引用と、GUI の外から差し込まれた注記は別の姿にする", () => {
  // どちらも「左罫 + text-quiet」のままだと、**Tomo が引用した文と Tomo では
  // ない声**が見分けられない —— ADR-0014 が分けようとしているものが混ざる。
  const quote = declarationsFor(css, ".md-content blockquote");
  const note = declarationsFor(css, ".chat-message--note");
  assert.notEqual(note["border-left"], quote["border-left"], "罫が同じ色");
  assert.ok(note["background-color"] !== undefined, "色相だけに頼らない差（塗りの有無）");
  assert.equal(quote["background-color"], undefined, "引用は地の上に置いたまま");
});
