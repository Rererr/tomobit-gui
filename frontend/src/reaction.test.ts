import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canSendReaction,
  confirmedReaction,
  drainOutbox,
  isLatestTurn,
  reactionGlyph,
  reactionLabel,
  reactionLine,
  reactionState,
  ReactionOutbox,
  TurnIndex,
} from "./reaction.ts";
import type { MouthState, ReactionWord } from "./reaction.ts";
import { asReactionEvent, asReactionVocabulary } from "./types.ts";

const VOCAB: ReactionWord[] = [
  { word: "up", label: "文句なし" },
  { word: "meh", label: "まあまあ（手を焼いた）" },
  { word: "down", label: "だめだった" },
];

// --- 語彙は本体のもの（本体 ADR-0057 Decision 3 / GUI ADR-0014 Decision 4） ---

test("init が配った語彙をそのまま読む", () => {
  const v = asReactionVocabulary({
    type: "init",
    v: 1,
    reactions: [
      { word: "up", label: "文句なし" },
      { word: "meh", label: "まあまあ（手を焼いた）" },
      { word: "down", label: "だめだった" },
    ],
  });
  assert.deepEqual(v, VOCAB);
});

test("init に reactions が無ければ口を出さない", () => {
  assert.equal(asReactionVocabulary({ type: "init", v: 1 }), null, "古い本体では反応の口が消える");
  assert.equal(asReactionVocabulary({ type: "init", v: 1, reactions: [] }), null);
});

test("半端な語彙は語彙として受け取らない", () => {
  // 読めた語だけを残すと、**本体が受け付ける語のうち一部だけが押せる**口になる
  // —— 押せなかった語は、人からは「そんな反応は無い」と見える。
  const ok = { word: "up", label: "文句なし" };
  assert.equal(asReactionVocabulary({ type: "init", reactions: [ok, { word: "meh" }] }), null, "ラベルが無い");
  assert.equal(asReactionVocabulary({ type: "init", reactions: [ok, { label: "だめだった" }] }), null, "語が無い");
  assert.equal(asReactionVocabulary({ type: "init", reactions: [ok, { word: "", label: "空" }] }), null);
  assert.equal(asReactionVocabulary({ type: "init", reactions: [ok, "meh"] }), null, "要素が object ですらない");
  assert.equal(asReactionVocabulary({ type: "init", reactions: "up,down" }), null, "配列ですらない");
});

test("同じ word が2つある語彙は受け取らない", () => {
  // 同じ記号のボタンが2つ並び、React の key も重複する。どちらを押しても同じ行が
  // 飛ぶので、片方は「押しても何も変わらないボタン」になる。
  const dup = [
    { word: "up", label: "文句なし" },
    { word: "up", label: "やっぱり文句なし" },
  ];
  assert.equal(asReactionVocabulary({ type: "init", reactions: dup }), null);
});

test("予約語 clear を含む語彙は受け取らない", () => {
  // 本体は取り消しを語彙として配らない（本体 ADR-0057 Decision 3: あれは語ではなく
  // 操作）。受け取ると「取り消し」が置ける反応の1つとして並び、印を置いたつもりで
  // 印を外す口になる。
  const withClear = [
    { word: "up", label: "文句なし" },
    { word: "clear", label: "取り消し" },
  ];
  assert.equal(asReactionVocabulary({ type: "init", reactions: withClear }), null);
});

test("知らない word には記号を発明せず、本体のラベル文字を出す", () => {
  assert.equal(reactionGlyph("up", VOCAB), "👍");
  assert.equal(reactionGlyph("meh", VOCAB), "🤔");
  assert.equal(reactionGlyph("down", VOCAB), "👎");
  // 本体が語を足した日: 記号は知らないが、ラベルは本体が配っている。
  const extended = [...VOCAB, { word: "wow", label: "驚いた" }];
  assert.equal(reactionGlyph("wow", extended), "驚いた");
  // 語彙すら配られていない（過去セッションを新しい語で開いた）なら語そのもの。
  assert.equal(reactionGlyph("wow", null), "wow");
  assert.equal(reactionLabel("up", VOCAB), "文句なし");
  assert.equal(reactionLabel("wow", VOCAB), "wow");
});

// --- 本体が記帳したものだけが印になる（押した通りに描かない） ---

test("reaction イベントは n と word が読めた時だけ受け取る", () => {
  assert.deepEqual(asReactionEvent({ type: "reaction", n: 3, word: "up" }), { n: 3, word: "up" });
  assert.equal(asReactionEvent({ type: "reaction", word: "up" }), undefined);
  assert.equal(asReactionEvent({ type: "reaction", n: "3", word: "up" }), undefined);
  assert.equal(asReactionEvent({ type: "reaction", n: 3 }), undefined);
  assert.equal(asReactionEvent({ type: "reaction", n: 3, word: "" }), undefined);
});

test("ターン番号は正の整数だけ — 本体が受け取らない番号の印は名乗らない", () => {
  // 本体のターン番号は1から振られる（本体 ADR-0022 Decision 1 / ADR-0057
  // Decision 1）。契約外の値を通すと、台帳に存在しないターンの印を画面が名乗る。
  assert.equal(asReactionEvent({ type: "reaction", n: 0, word: "up" }), undefined, "0 番のターンは無い");
  assert.equal(asReactionEvent({ type: "reaction", n: -1, word: "up" }), undefined);
  assert.equal(asReactionEvent({ type: "reaction", n: 1.5, word: "up" }), undefined, "小数のターンは無い");
  assert.equal(asReactionEvent({ type: "reaction", n: Number.NaN, word: "up" }), undefined);
  assert.equal(asReactionEvent({ type: "reaction", n: Number.POSITIVE_INFINITY, word: "up" }), undefined);
  assert.deepEqual(asReactionEvent({ type: "reaction", n: 1, word: "up" }), { n: 1, word: "up" }, "1 は最初のターン");
});

test("clear は印を外す — 取り消しは「答えない」であって「答えた」ではない", () => {
  assert.equal(confirmedReaction("up"), "up");
  assert.equal(confirmedReaction("clear"), undefined);
});

test("送る行は /react <turn> <word> の1行", () => {
  assert.equal(reactionLine(3, "up"), "/react 3 up");
  assert.equal(reactionLine(5, "clear"), "/react 5 clear");
});

// --- 会話の最後のターン（ADR-0014 Decision 4「ホバー無しでも出す」の判定） ---

test("最後のターンは true、その手前のターンは false", () => {
  const messages = [{ kind: "user" }, { kind: "turn" }, { kind: "user" }, { kind: "turn" }];
  assert.equal(isLatestTurn(messages, 1), false, "手前のターン");
  assert.equal(isLatestTurn(messages, 3), true, "最後のターン");
});

test("ターンの後ろに note / system / stderr が続いても、そのターンは true のまま", () => {
  // 境界の器官の note・GUI 自身の system 注記・stderr は名前欄を持たない
  // 「会話の脇からの声」で、ターンの後に挟まっても「最後のターン」を奪わない
  // —— ここがこの修正の本体。CSS の `:last-child` はこの3つのどれが末尾に
  // 来ても崩れていた（実機で note が再現）。
  const messages = [
    { kind: "user" },
    { kind: "turn" },
    { kind: "note" },
    { kind: "system" },
    { kind: "stderr" },
  ];
  assert.equal(isLatestTurn(messages, 1), true);
});

test("ターンが1つも無い配列では、どの位置も false", () => {
  const messages = [{ kind: "user" }, { kind: "note" }, { kind: "system" }];
  for (let i = 0; i < messages.length; i++) {
    assert.equal(isLatestTurn(messages, i), false, `index ${i}`);
  }
});

test("user メッセージは常に false — 配列の最後の要素であっても", () => {
  const messages = [{ kind: "turn" }, { kind: "user" }];
  assert.equal(isLatestTurn(messages, 1), false, "user はターンを名乗らない");
  assert.equal(isLatestTurn(messages, 0), true, "user の手前のターンは依然として最後のターン");
});

// --- ボタンの姿（送信待ちと、確定した印を見分ける） ---

test("押した印は、本体が記帳するまで送信待ちとして描く", () => {
  assert.equal(reactionState({}, "up"), "idle");
  assert.equal(reactionState({ reaction: "up" }, "up"), "placed");
  assert.equal(reactionState({ reactionPending: "up" }, "up"), "placing");
  // 取り消し中は、いま置かれている語の側が「外れる待ち」になる。
  assert.equal(reactionState({ reaction: "up", reactionPending: "clear" }, "up"), "clearing");
  assert.equal(reactionState({ reaction: "up", reactionPending: "clear" }, "down"), "idle");
  // 差し替え中は、古い語は待たずに外れる側へ落ちる。
  assert.equal(reactionState({ reaction: "up", reactionPending: "down" }, "up"), "idle");
  assert.equal(reactionState({ reaction: "up", reactionPending: "down" }, "down"), "placing");
});

// --- ターン番号は、いま開いているタスクの中でしか意味を持たない ---

test("区切りを跨ぐと、同じ n は別のタスクの枠を指す", () => {
  const turns = new TurnIndex<string>();
  turns.start(1, "task1-turn1");
  assert.equal(turns.target(1), "task1-turn1");

  // 台帳の n はタスクごとに1から振り直される（本体 ADR-0022 Decision 1）。
  turns.reset();
  assert.equal(turns.target(1), null, "区切りの向こう側のターンへは付かない");
  turns.start(1, "task2-turn1");
  assert.equal(turns.target(1), "task2-turn1");
  assert.deepEqual(turns.refs(), ["task2-turn1"], "置ける枠も今のタスクのぶんだけ");
});

test("同じ n が繰り返されたら後の枠を採る — 結論が着地する枠に口を立てる", () => {
  // 同じ n が繰り返されるのは分割の畳み戻し（本体 ADR-0028/0030）で、
  // **2つ目の枠こそが結論**（親Providerの統合報告）である。1つ目は「分割して
  // 走らせる」というアナウンスで、人が読んで反応したいのは結論の方。
  const turns = new TurnIndex<string>();
  assert.equal(turns.start(1, "announce"), null, "初めての n は何も置き換えない");
  assert.equal(turns.start(1, "conclusion"), "announce", "置き換えた前の枠を返す（印の移し先が要る）");
  assert.equal(turns.target(1), "conclusion");
  assert.deepEqual(turns.refs(), ["conclusion"], "アナウンスの枠にはもう口を出さない");
});

test("同じ枠を置き直しても、移す先が無いので null", () => {
  const turns = new TurnIndex<string>();
  turns.start(1, "same");
  assert.equal(turns.start(1, "same"), null, "自分から自分へ印を移させない");
});

test("印はタスクにつき1つ — 記帳が返った枠以外は降ろす", () => {
  // 締めが読むのはそのタスクの最後の1件だけ（本体 ADR-0057 Decision 2）。
  // 3ターン目の 👍 と7ターン目の 👎 が同時に見える画面は、記録される内容に
  // ついて嘘をつく。
  const turns = new TurnIndex<string>();
  turns.start(1, "t1");
  turns.start(2, "t2");
  turns.start(3, "t3");
  assert.deepEqual(turns.others("t2"), ["t1", "t3"]);
  assert.deepEqual(turns.others("t1"), ["t2", "t3"]);

  turns.reset();
  turns.start(1, "task2-t1");
  assert.deepEqual(turns.others("task2-t1"), [], "区切りの向こう側の印は降ろさない（別タスクの答え）");
});

test("枠の実体は呼び出し側が決める（ライブは id、再生は index）", () => {
  const byIndex = new TurnIndex<number>();
  byIndex.start(2, 7);
  assert.equal(byIndex.target(2), 7);
  assert.equal(byIndex.target(3), null);
});

// --- 問いが立っている間は送らない（行を飲まれるから） ---

const FREE: MouthState = { running: false, permissionAsked: false, boundaryActive: false, closing: false };

test("口が塞がっている理由はどれも等しく送信を止める", () => {
  assert.equal(canSendReaction(FREE), true);
  assert.equal(canSendReaction({ ...FREE, running: true }), false, "走行中");
  assert.equal(canSendReaction({ ...FREE, permissionAsked: true }), false, "権限の問い");
  assert.equal(canSendReaction({ ...FREE, boundaryActive: true }), false, "境界の器官が待っている");
  assert.equal(canSendReaction({ ...FREE, closing: true }), false, "窓の×が始めた締め");
});

test("走行中に押した反応は溜まり、口が空いてから送られる", () => {
  const outbox = new ReactionOutbox();
  outbox.place(3, "up");
  assert.equal(outbox.next({ ...FREE, running: true }), null, "走行中の行は権限の答えとして飲まれる");
  assert.equal(outbox.next({ ...FREE, permissionAsked: true }), null);
  assert.equal(outbox.next({ ...FREE, boundaryActive: true }), null);
  assert.equal(outbox.next({ ...FREE, closing: true }), null);
  assert.deepEqual(outbox.next(FREE), { n: 3, word: "up" }, "口が空いた瞬間に流れる");
  assert.equal(outbox.next(FREE), null, "流したものは残らない");
});

test("同じターンへの連打は、最後の1つだけが送られる", () => {
  const outbox = new ReactionOutbox();
  outbox.place(3, "up");
  outbox.place(3, "down");
  outbox.place(3, "clear");
  assert.deepEqual(outbox.next(FREE), { n: 3, word: "clear" });
  assert.equal(outbox.next(FREE), null, "指の震えは台帳に残さない");
});

test("送るのは押した順 — 押し直したターンは列の最後へ回る", () => {
  // 本体は**最後に届いたイベント**を締めの答えにする（本体 ADR-0057 Decision 2）
  // ので、送る順が押した順と食い違うと画面と台帳が食い違う。n=1 を押し直した
  // 後に n=2 の行が流れると、人が最後に押したのは n=1 なのに台帳の最後は n=2 になる。
  const outbox = new ReactionOutbox();
  outbox.place(1, "up");
  outbox.place(2, "down");
  outbox.place(1, "clear");
  assert.deepEqual(outbox.next(FREE), { n: 2, word: "down" }, "押し直す前の n=1 は列の先頭に残らない");
  assert.deepEqual(outbox.next(FREE), { n: 1, word: "clear" }, "最後に押したものが最後に届く");
  assert.equal(outbox.next(FREE), null);
});

test("送信の途中で口が塞がったら、残りは溜めたままにする", () => {
  const outbox = new ReactionOutbox();
  outbox.place(1, "up");
  outbox.place(2, "down");
  assert.deepEqual(outbox.next(FREE), { n: 1, word: "up" });
  // 1件目を送っているあいだに権限の問いが立った。
  assert.equal(outbox.next({ ...FREE, permissionAsked: true }), null);
  assert.deepEqual(outbox.next(FREE), { n: 2, word: "down" }, "答え終われば残りが流れる");
});

test("宛先が消えたら捨てる — 捨てた枠は呼び出し側が印を戻せる", () => {
  const outbox = new ReactionOutbox();
  outbox.place(3, "up");
  outbox.place(5, "down");
  assert.deepEqual(outbox.drop(), [3, 5]);
  assert.equal(outbox.next(FREE), null, "区切ったタスクへは送らない");
  assert.deepEqual(outbox.drop(), [], "捨てるものが無ければ何も言わない");
});

// --- 送ったが記帳が返っていないぶんも「置いたまま」である ---

test("送信済みで記帳が返っていない反応も、捨てる時に数える", () => {
  // 本体が断った反応は view に来ない（押した通りには描かない — ADR-0014
  // Decision 4）。溜め場から抜けた＝黙って消えてよい、ではない: 押した人に
  // とっては「置いた」ままで、画面にも送信待ちの印が残っている。
  const outbox = new ReactionOutbox();
  outbox.place(3, "up");
  assert.deepEqual(outbox.next(FREE), { n: 3, word: "up" }, "送った（記帳の確認はまだ）");
  assert.deepEqual(outbox.drop(), [3], "まだ送っていないぶんだけを数えると、1行も言われずに消える");
});

test("記帳が返ったものは、もう宙に浮いていない", () => {
  const outbox = new ReactionOutbox();
  outbox.place(3, "up");
  outbox.next(FREE);
  outbox.settle(3);
  assert.deepEqual(outbox.drop(), [], "確定した印まで「記帳されなかった」と言わない");
});

test("送信待ちと送信済みが同じターンで重なっても、捨てた枠は1つ", () => {
  const outbox = new ReactionOutbox();
  outbox.place(3, "up");
  outbox.next(FREE); // 送った（未記帳）
  outbox.place(3, "down"); // 記帳が返る前に押し直した
  assert.deepEqual(outbox.drop(), [3]);
});

// --- 溜め場を流すループ (drainOutbox) ---

const alwaysFree = () => FREE;

test("押した順に送る（流すところまで通して）", async () => {
  const outbox = new ReactionOutbox();
  outbox.place(1, "up");
  outbox.place(2, "down");
  outbox.place(1, "clear");
  const sent: string[] = [];
  await drainOutbox(outbox, alwaysFree, async (n, word) => {
    sent.push(reactionLine(n, word));
    return true;
  });
  assert.deepEqual(sent, ["/react 2 down", "/react 1 clear"]);
});

test("送信ループは1本だけ — 押下と「口が空いた」が同時に呼んでも二重に送らない", async () => {
  // 反応を流しにいくのは2箇所（押した瞬間と、口が空いた瞬間の effect）。
  // 再入すると、await のあいだに入ったもう1本が同じ溜め場から取り出し、
  // 台帳に同じ行が2回並ぶ。
  const outbox = new ReactionOutbox();
  outbox.place(1, "up");
  outbox.place(2, "down");
  const sent: number[] = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const send = async (n: number) => {
    sent.push(n);
    await gate;
    return true;
  };
  const first = drainOutbox(outbox, alwaysFree, send);
  // 1件目の await の最中に、もう1本走り出そうとする。await せずに見るのは、
  // 再入するループが**同期のうちに**次の1件を取り出すから（そこを掴まえないと、
  // 二重送信したループの完了を待つことになって固まる）。
  const second = drainOutbox(outbox, alwaysFree, send);
  try {
    assert.deepEqual(sent, [1], "2本目のループが同じ溜め場から取り出した");
  } finally {
    release();
  }
  await Promise.all([first, second]);
  assert.deepEqual(sent, [1, 2], "1本目は最後まで流し切る");
});

test("送信の途中で口が塞がったら、そこで止めて残りは溜めたままにする", async () => {
  // 口の状態は1件ごとに読み直す: await のあいだに権限の問い (本体 ADR-0053) が
  // 立つと、その先の行は問いへの答えとして飲まれる。
  const outbox = new ReactionOutbox();
  outbox.place(1, "up");
  outbox.place(2, "down");
  // 口の状態は呼ばれるたびに作る（useChatSession の mouthNow が ref から
  // 組み立てるのと同じ）。同じオブジェクトを配ると、**1度しか読まない実装でも
  // 中身が後から変わって**このテストが通ってしまう。
  let permissionAsked = false;
  const mouth = (): MouthState => ({ ...FREE, permissionAsked });
  const sent: number[] = [];
  await drainOutbox(outbox, mouth, async (n) => {
    sent.push(n);
    permissionAsked = true;
    return true;
  });
  assert.deepEqual(sent, [1], "塞がった口へ2件目を書いた");

  permissionAsked = false;
  await drainOutbox(outbox, mouth, async (n) => {
    sent.push(n);
    return true;
  });
  assert.deepEqual(sent, [1, 2], "答え終われば残りが流れる");
});

test("送れなかったら、そこで止めて宙に浮かせない", async () => {
  const outbox = new ReactionOutbox();
  outbox.place(1, "up");
  outbox.place(2, "down");
  const sent: number[] = [];
  await drainOutbox(outbox, alwaysFree, async (n) => {
    sent.push(n);
    return false;
  });
  assert.deepEqual(sent, [1], "1件目が送れないのに2件目を送らない");
  assert.deepEqual(outbox.drop(), [2], "送れなかった1件は記帳を待たない（呼び出し側が印を降ろす）");
});
