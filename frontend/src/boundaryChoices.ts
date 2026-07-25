// 締めの質問をボタンへ翻訳する (ADR-0005 Decision 2)。
//
// 境界の器官（Feedback・Tomoの質問・鏡）はどれも端末のプロンプトを
// `{"type":"note","await":true}` として流してくる。文面は本体のもので、
// 語彙も選択肢も本体が決める:
//
//   今回、どうだった? [1=文句なし / 2=まあまあ（手を焼いた） / 3=だめだった / Enter=まだ言えない]
//   「…」 [1=意外 / 2=知ってた / 3=それ違う / Enter=スキップ]
//
// GUI は選択肢の一覧を持たない — 届いた行の角括弧をそのまま読む。持てば
// 本体が語彙を足した日に GUI が黙って古い選択肢を出し続ける（forget.go が
// 「検証者を増やさない」と書いたのと同じ理由）。
export interface BoundaryChoice {
  /** 送る文字列。Enter の選択肢は空文字（本体の「無信号」経路） */
  send: string;
  /** ボタンの文字 */
  label: string;
}

export interface BoundaryQuestion {
  /** 角括弧を取り除いた問いの本文 */
  prompt: string;
  /** 角括弧から読んだ選択肢。読めなければ空 */
  choices: BoundaryChoice[];
}

// 選択肢の並びは行が書いた順のまま。危険な既定を作らないため、並べ替えも
// 「おすすめ」の印もつけない。
function parseChoiceList(inside: string): BoundaryChoice[] {
  const choices: BoundaryChoice[] = [];
  // ラベルに `/` が入りうるので、区切りは前後に空白のある `/` だけを見る。
  for (const part of inside.split(/\s+\/\s+/)) {
    const eq = part.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = part.slice(0, eq).trim();
    const label = part.slice(eq + 1).trim();
    if (label === "") {
      continue;
    }
    choices.push({ send: key === "Enter" ? "" : key, label });
  }
  return choices;
}

/**
 * await の note を「本文 + ボタン」に割る。角括弧が無い（＝自由記述を待って
 * いる）行では choices が空になる — 呼び出し側は入力欄を出すこと。
 */
export function parseBoundaryQuestion(text: string): BoundaryQuestion {
  const open = text.lastIndexOf("[");
  const close = text.indexOf("]", open);
  if (open < 0 || close < 0) {
    return { prompt: text.trim(), choices: [] };
  }
  const choices = parseChoiceList(text.slice(open + 1, close));
  if (choices.length === 0) {
    return { prompt: text.trim(), choices: [] };
  }
  return { prompt: text.slice(0, open).trim(), choices };
}
