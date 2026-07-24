import type { GrowthGateView } from "../growthView";
import { gateLabel, gateState, gateTargetText, gateValueText } from "../growthView";

// ヘッダのステージから開く成長の内訳（本体 ADR-0046）。DecidedDisclosure と
// 同じ読み取り専用のテーブル描画で、数値は本体 growth の写しだけ。
// 「測定不能」（value: null）は数値バーの0や未達の✗と同じ顔をさせない —
// 行の見た目とセル文言の両方で区別する（色だけに頼らない）。

export interface GrowthView {
  next: number;
  next_name: string;
  gates: GrowthGateView[];
}

export function GrowthDisclosure({ growth }: { growth: GrowthView }) {
  return (
    <div className="growth-disclosure">
      <p className="growth-next">
        次は <strong>{growth.next_name}</strong> — 足りないものと、動かせる一手:
      </p>
      <table className="growth-table">
        <caption className="sr-only">次の段のゲート: 値・目標・次の一手</caption>
        <colgroup>
          <col className="growth-col-gate" />
          <col className="growth-col-value" />
          <col className="growth-col-target" />
          <col className="growth-col-hint" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">ゲート</th>
            <th scope="col">いま</th>
            <th scope="col">目標</th>
            <th scope="col">次の一手</th>
          </tr>
        </thead>
        <tbody>
          {growth.gates.map((gate, i) => {
            const state = gateState(gate);
            return (
              <tr key={i} className={`growth-row growth-row--${state}`}>
                <td>{gateLabel(gate.name)}</td>
                <td className={state === "unmeasurable" ? "growth-cell-unmeasurable" : undefined}>
                  {state === "met" && <span aria-hidden="true">✓ </span>}
                  {gateValueText(gate)}
                </td>
                <td>{gateTargetText(gate.name, gate.threshold)}</td>
                <td className="growth-cell-hint">{gate.hint ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
