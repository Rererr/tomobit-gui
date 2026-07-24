// 成長開示（本体 ADR-0046）の表示ロジック。数値はすべて本体の growth を
// そのまま写すだけで、GUI側では一切再計算しない（本体 ADR-0039 と同じ規律）。
// 「測定不能」（value: null — 競争のある島が無い等）と「未達」（値があって
// 閾値に届かない）を同じ顔にしないことが、本体 ADR-0046 が実装の合否と
// 定めた点なので、その区別だけをここで型にする。

export interface GrowthGateView {
  name: string;
  value?: number | null;
  threshold: number;
  met: boolean;
  hint?: string;
}

export type GateState = "met" | "unmet" | "unmeasurable";

export function gateState(gate: GrowthGateView): GateState {
  if (gate.met) {
    return "met";
  }
  return gate.value === null || gate.value === undefined ? "unmeasurable" : "unmet";
}

const GATE_LABELS: Record<string, string> = {
  connection: "つながり",
  evidence: "経験",
  calibration_sample: "較正の標本",
  calibration: "較正",
  sharpness: "鋭さ",
  preference_with_human: "あなたとの好み",
};

// 未知のゲート名は本体の語をそのまま見せる（前方互換 — 将来のゲートを
// 黙って落とすより、生の名前が出る方が正直）。
export function gateLabel(name: string): string {
  return GATE_LABELS[name] ?? name;
}

// 閾値の向き: evidence系は「以上」で越える床、calibration/sharpnessは
// 「以下」に収める天井（本体 stage.go のノブ定義）。未知のゲートは向きを
// 知らないので数値だけ見せる。
const CEILING_GATES = new Set(["calibration", "sharpness"]);
const FLOOR_GATES = new Set(["connection", "evidence", "calibration_sample", "preference_with_human"]);

export function gateTargetText(name: string, threshold: number): string {
  const n = formatGateNumber(threshold);
  if (CEILING_GATES.has(name)) {
    return `${n}以下`;
  }
  if (FLOOR_GATES.has(name)) {
    return `${n}以上`;
  }
  return n;
}

export function gateValueText(gate: GrowthGateView): string {
  if (gateState(gate) === "unmeasurable") {
    return "測定不能";
  }
  // gateState が unmeasurable でない限り value は数値（met なら本体が値を
  // 必ず持たせる）。契約破りの欠落は 0 でなく空で見せる — 偽の数値を作らない。
  return gate.value === null || gate.value === undefined ? "" : formatGateNumber(gate.value);
}

export function formatGateNumber(v: number): string {
  return String(Number(v.toFixed(2)));
}
