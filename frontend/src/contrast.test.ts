import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { contrastRatio, parseRootColorTokens, relativeLuminance } from "./contrast.ts";

const css = readFileSync(fileURLToPath(new URL("./App.css", import.meta.url)), "utf8");
const T = parseRootColorTokens(css);

function color(name: string): string {
  const v = T[name];
  assert.ok(v !== undefined, `App.css の :root に --color-${name} が無い`);
  return v;
}

test("相対輝度は既知の両端を再現する", () => {
  assert.equal(relativeLuminance("#000000"), 0);
  assert.equal(relativeLuminance("#ffffff"), 1);
  // 黒と白は 21:1（WCAG の上限）
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
});

test("トークンの取りこぼしは静かに通さない", () => {
  assert.throws(() => parseRootColorTokens("body { color: red; }"), /:root/);
  // var() 参照や色関数は「読めた」ことにしない — 拾わないので後段が落ちる
  assert.deepEqual(parseRootColorTokens(":root { --color-x: var(--color-y); }"), {});
});

// 実際に画面で重なる (前景, 背景, 用途) の組。CSSを目で追って作った表なので、
// 面や部品を足したらここにも足すこと — 逆に言えば、ここに無い組み合わせは
// 誰も検査していない。
//
// 4.5:1 は WCAG 1.4.3 AA（本文）。このアプリの文字は 11〜16px で、AA大文字
// 扱い(3:1)になる 18.66px 太字/24px には一つも届かないので、文字は全部 4.5。
const TEXT_PAIRS: [string, string, string][] = [
  ["text", "bg-app", "地の文 on アプリ地"],
  ["text", "bg-raised", "Tomo吹き出しの本文"],
  ["text", "bg-surface", "カード・入力欄の文字"],
  ["text", "bg-user-bubble", "自分の発言"],
  ["text", "bg-well", "最も凹んだ面の文字"],
  ["text-bright", "bg-active", "選択中のnav/セッション"],
  ["text-bright", "accent", "アクセントボタンの文言（送信ボタン）"],
  ["text-bright", "accent-hover", "アクセントボタンのホバー中"],
  ["text-secondary", "bg-app", "二次テキスト on 地"],
  ["text-secondary", "bg-sidebar", "サイドバーの二次テキスト"],
  ["text-secondary", "bg-well", "ツール出力の本文"],
  ["text-secondary", "bg-surface", "カード内の二次テキスト"],
  ["text-quiet", "bg-raised", "役割ラベル on Tomo吹き出し"],
  // 自分の吹き出しの役割ラベルは sr-only になったので、この面に text-quiet は
  // もう乗らない（乗せ直すならこの行も戻すこと）。
  ["text-quiet", "bg-app", "注記・引用 on 地"],
  ["text-muted", "bg-raised", "ツール行・detail on 吹き出し"],
  ["text-muted", "bg-surface", "ラベル on カード"],
  ["text-muted", "bg-app", "ラベル on 地"],
  ["text-muted", "bg-well", "ラベル on 溝"],
  ["text-muted-aa", "bg-app", "小さい注記 on 地"],
  ["text-muted-aa", "bg-raised", "小さい注記 on 吹き出し"],
  ["text-muted-aa", "bg-surface", "小さい注記 on カード"],
  ["text-muted-aa", "bg-well", "小さい注記 on 溝"],
  ["text-muted-aa", "bg-sidebar", "小さい注記 on サイドバー"],
  ["link", "bg-raised", "リンク on 吹き出し"],
  ["link", "bg-app", "リンク on 地"],
  ["link-hover", "bg-raised", "リンクのホバー on 吹き出し"],
  ["warning", "bg-raised", "provider.error on 吹き出し"],
  ["warning", "bg-app", "stderr on 地"],
  ["warning", "bg-surface", "警告 on カード"],
  ["warning-bright", "bg-well", "fallbackで採用された行"],
  ["success", "bg-surface", "成功表示 on カード"],
  ["success", "bg-app", "成功表示 on 地"],
];

for (const [fg, bg, label] of TEXT_PAIRS) {
  test(`AA(4.5:1): ${label}`, () => {
    const r = contrastRatio(color(fg), color(bg));
    assert.ok(r >= 4.5, `${fg} on ${bg} が ${r.toFixed(2)}:1（4.5:1 未満）— ${label}`);
  });
}

// WCAG 1.4.11 の 3:1。対象は「部品や状態の識別に必要な視覚情報」だけ。
// 塗りを持つ部品の輪郭（border-input）や、純粋な区切り線（border-subtle）は
// 対象外なのでここに置かない — 満たしていない値を表に入れて閾値の方を下げる
// と、表そのものが意味を失う。
const NON_TEXT_PAIRS: [string, string, string][] = [
  // background:transparent のボタン群（.add-pane-btn / .settings-retry-btn /
  // .memory-act-btn ら）は、この罫だけが「押せる何か」の輪郭になる。
  ["border", "bg-app", "塗り無しボタンの輪郭 on 地"],
  ["border", "bg-sidebar", "塗り無しボタンの輪郭 on サイドバー"],
  ["border", "bg-surface", "塗り無しボタンの輪郭 on カード"],
  ["accent", "bg-app", "アクセント面・実行中の帯の丸(ADR-0008) on 地"],
  ["focus", "bg-surface", ":focus の輪郭・締めの待ちの丸(ADR-0008) on 入力欄/カードの地"],
  ["focus", "bg-well", ":focus の輪郭 on 溝（メモリ編集欄）"],
  ["focus", "bg-app", ":focus の輪郭 on 地"],
  ["warning-accent", "bg-well", "残量バー on 溝"],
  // provider チップの枠は text 系トークンを流用している
  ["text-muted-aa", "bg-raised", "providerチップの枠"],
];

for (const [fg, bg, label] of NON_TEXT_PAIRS) {
  test(`非テキスト(3:1): ${label}`, () => {
    const r = contrastRatio(color(fg), color(bg));
    assert.ok(r >= 3, `${fg} on ${bg} が ${r.toFixed(2)}:1（3:1 未満）— ${label}`);
  });
}

// 上限も見る。暗地にほぼ白は滲んで読み疲れるので、地の文は AAA(7:1) に余裕を
// 持たせつつ天井を切る。「コントラストは高いほど良い」は 1.4.3 の要求ではない。
test("地の文のコントラストは上げ切らない（滲み対策の天井）", () => {
  const r = contrastRatio(color("text"), color("bg-app"));
  assert.ok(r >= 7, `地の文が ${r.toFixed(2)}:1 — AAA(7:1) を割っている`);
  assert.ok(r <= 13.5, `地の文が ${r.toFixed(2)}:1 — 暗地に対して明るすぎる`);
});

// 面が同じ明るさに見えると階層が消える。1.4.x の要求ではないので下限だけ、
// しかも「見分けられる最小限」に置く（実測: 溝1.10 / カード1.10 / 吹き出し1.20）。
test("面どうしが見分けられる程度には離れている", () => {
  for (const surface of ["bg-well", "bg-surface", "bg-raised"]) {
    const r = contrastRatio(color(surface), color("bg-app"));
    assert.ok(r >= 1.08, `${surface} が地と ${r.toFixed(2)}:1 — 面として見えない`);
  }
});

// 自分の発言とTomoの発言は、明度だけでなく色相でも分かれていてほしい
// （面の色相を暖色で揃えた時に、Youの吹き出しが埋没した実測がある）。
test("自分の吹き出しはTomoの吹き出しと色相で分かれている", () => {
  const you = color("bg-user-bubble").slice(1);
  const tomo = color("bg-raised").slice(1);
  const blueMinusRed = (h: string) => parseInt(h.slice(4, 6), 16) - parseInt(h.slice(0, 2), 16);
  // Tomo側は暖色（R>B）、You側は寒色（B>R）。符号が割れていれば色相は別。
  assert.ok(blueMinusRed(tomo) < 0, "Tomoの吹き出しが暖色でない");
  assert.ok(blueMinusRed(you) > 0, "自分の吹き出しが寒色でない");
});
