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
  // 会話は器（背景）を持たず地(bg-app)に直接乗る (ADR-0014 Decision 1)。
  // 自分の発言・Tomoの発言はどちらもここに合流した——以前は別の面
  // (bg-user-bubble / bg-raised) を持っていたが、話者は名前が言うので
  // 面を分ける理由が無くなった。
  ["text", "bg-app", "地の文（自分の発言・Tomoの発言を含む）on アプリ地"],
  ["text", "bg-raised", "隆起面のボタン文字（最新へ／締めの選択肢など）"],
  ["text", "bg-surface", "カード・入力欄の文字"],
  ["text", "bg-well", "最も凹んだ面の文字"],
  ["text-bright", "bg-active", "選択中のnav/セッション"],
  ["text-bright", "accent", "アクセントボタンの文言（送信ボタン）"],
  ["text-bright", "accent-hover", "アクセントボタンのホバー中"],
  ["text-secondary", "bg-app", "二次テキスト on 地"],
  ["text-secondary", "bg-sidebar", "サイドバーの二次テキスト"],
  ["text-secondary", "bg-well", "ツール出力の本文"],
  ["text-secondary", "bg-surface", "カード内の二次テキスト"],
  // 役割ラベル(You/Tomo)も会話と同じ地に乗る——連続する同じ話者では
  // sr-only に切り替わるので、目に出る時は常にこの組み合わせになる。
  ["text-quiet", "bg-app", "注記・引用・話者名(You/Tomo) on 地"],
  // 器官の注記 (.chat-message--note) は、Markdownの引用と見分けるために塗りを持つ
  // （罫の色だけで分けると、色を見分けられない人には同じ視覚文法のまま）。
  ["text-quiet", "bg-surface", "器官の注記の文字 on 注記の塗り"],
  ["text-muted", "bg-raised", "サブタスクチップの文字"],
  ["text-muted", "bg-surface", "ラベル on カード"],
  ["text-muted", "bg-app", "ラベル on 地（ツール行・ターンのメタ行を含む）"],
  ["text-muted", "bg-well", "ラベル on 溝"],
  ["text-muted-aa", "bg-app", "小さい注記 on 地（ターンのメタ行を含む）"],
  ["text-muted-aa", "bg-surface", "小さい注記 on カード"],
  ["text-muted-aa", "bg-well", "小さい注記 on 溝"],
  ["text-muted-aa", "bg-sidebar", "小さい注記 on サイドバー"],
  ["link", "bg-app", "リンク on 地"],
  ["link-hover", "bg-app", "リンクのホバー on 地"],
  ["warning", "bg-app", "stderr・provider.error on 地"],
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
  // 器官の注記の左罫は、地の上に立つ縦線として読まれる（内側の塗りとの境目では
  // なく、会話面との境目が識別の手がかり）。注記の塗り(bg-surface)との組み合わせは
  // 2.87:1 で 3:1 に届かないが、そちらは「塗りを持つ部品の内側の輪郭」なので
  // border-input と同じ扱いで表に入れない — 満たさない値を入れて閾値を下げない。
  ["accent", "bg-app", "器官の注記の左罫 on 地（Markdownの引用の罫と分ける色）"],
  // 反応の送信待ちは破線の輪郭で描く (ADR-0014 Decision 4)。以前は
  // filter: opacity(0.55) で要素ごと薄めており、実効色 #4b4741 = 1.89:1 だった —
  // filter の結果はこの表に載らないので、輪郭は輪郭のプロパティで書く。
  ["border", "bg-app", "反応の口の輪郭（置いた印・送信待ちの破線）on 地"],
  ["focus", "bg-surface", ":focus の輪郭・締めの待ちの丸(ADR-0008) on 入力欄/カードの地"],
  ["focus", "bg-well", ":focus の輪郭 on 溝（メモリ編集欄）"],
  ["focus", "bg-app", ":focus の輪郭 on 地"],
  ["warning-accent", "bg-well", "残量バー on 溝"],
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
// しかも「見分けられる最小限」に置く（実測: 溝1.10 / カード1.10 / 隆起面1.20）。
test("面どうしが見分けられる程度には離れている", () => {
  for (const surface of ["bg-well", "bg-surface", "bg-raised"]) {
    const r = contrastRatio(color(surface), color("bg-app"));
    assert.ok(r >= 1.08, `${surface} が地と ${r.toFixed(2)}:1 — 面として見えない`);
  }
});
