import type { main } from "../wailsjs/go/models";

/**
 * sharedPlaces returns the ids of panes whose working directory another pane
 * also holds (ADR-0009 Decision 6).
 *
 * GUI は止めない。禁止も警告のモーダルも出さない — 判断の座席を作れば、
 * 隔離（本体 ADR-0050）が効いていて安全な組み合わせまで禁じることになる。
 * ここが返すのは観測事実だけで、それを1行言うかどうかは画面の仕事。
 *
 * 場所を設定していない窓（"" ）は数えない: まだどこでも働いていないので、
 * 共有しているものが無い。
 */
export function sharedPlaces(panes: main.PaneConfig[]): Set<string> {
  const byPlace = new Map<string, string[]>();
  for (const pane of panes) {
    const place = (pane.working_dir ?? "").trim();
    if (place === "") {
      continue;
    }
    const ids = byPlace.get(place) ?? [];
    ids.push(pane.id);
    byPlace.set(place, ids);
  }
  const shared = new Set<string>();
  for (const ids of byPlace.values()) {
    if (ids.length > 1) {
      ids.forEach((id) => shared.add(id));
    }
  }
  return shared;
}

/**
 * paneGridClass names the layout for a pane count (ADR-0009 Decision 2: 窓の
 * 上限は4)。CSS 側が実際の格子を持ち、ここは「何分割か」だけを言う。
 *
 * 3窓のときの余りセルは CSS が決める（実装時ノブ）— 数の写像だけがここにある。
 */
export function paneGridClass(count: number): string {
  const clamped = Math.min(Math.max(count, 1), 4);
  return `pane-grid pane-grid-${clamped}`;
}
