import { useEffect, useRef } from "react";
import type { main } from "../../wailsjs/go/models";
import { bobOffset, headroom, overlayFor, stepBlink } from "../spriteView";
import type { BlinkState } from "../spriteView";

interface TomoPresenceProps {
  sheet: main.SpriteSheet;
  /** 台帳から導出した今のステージ（本体 status --view json） */
  stage: number;
  /** 気分記号。"" は素の姿 */
  marker: string;
}

// 整数拡大のみ（本体 ADR-0020 Decision 4）。3倍=96px角は260pxのサイドバーで
// 会話面を圧迫しない大きさ。非整数はドットの輪郭を壊すので選択肢に無い。
const SCALE = 3;

// blit は格子1枚を論理ピクセル単位で塗る。'.'（パレットに無い文字）は透明 —
// 塗らないことがそのまま透過になる。
function blit(ctx: CanvasRenderingContext2D, palette: Record<string, string>, rows: string[], ox: number, oy: number) {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x]];
      if (color === undefined) {
        continue;
      }
      ctx.fillStyle = color;
      ctx.fillRect((ox + x) * SCALE, (oy + y) * SCALE, SCALE, SCALE);
    }
  }
}

/**
 * サイドバーのTomo (ADR-0006 Decision 2)。姿は顔窓と同じ資産・同じノブで動く
 * — スプライトもアニメの数字も本体 `tomobit-face --view json` が配ったもので、
 * このファイルは格子を1つも持たない。
 *
 * セリフは出さない: Tomoの言葉はチャット面と（一言は）ヘッダが持つ。ここに
 * 三つ目の口を作ると、同じ言葉が二箇所で違うタイミングに出る。
 */
export function TomoPresence({ sheet, stage, marker }: TomoPresenceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const pad = headroom(sheet);
  const width = sheet.size * SCALE;
  const height = (sheet.size + pad) * SCALE;
  const stageAsset = sheet.stages.find((s) => s.stage === stage);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || stageAsset === undefined) {
      return;
    }

    function paint(frame: number, bob: number) {
      ctx!.clearRect(0, 0, width, height);
      blit(ctx!, sheet.palette, stageAsset!.frames[frame] ?? stageAsset!.frames[0], 0, pad + bob);
      const ov = overlayFor(sheet, stage, marker);
      if (ov !== null) {
        blit(ctx!, sheet.palette, ov.rows, ov.x, pad + ov.y + bob);
      }
    }

    // 動きを減らす設定の人には静止した姿を見せる: 常時アニメは
    // prefers-reduced-motion がまさに止めたいもの。居ることは姿が示す。
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      paint(0, 0);
      return;
    }

    const start = performance.now();
    let blink: BlinkState = { nextAtMs: start + sheet.anim.blink_min_ms, untilMs: 0 };
    // 直前に描いた絵。rAFは毎秒60回来るが絵が変わるのは瞬きと呼吸の境目だけ
    // なので、同じ絵の描き直しはここで落とす。
    let painted = "";
    let raf = 0;

    function tick(now: number) {
      const res = stepBlink(now, blink, sheet.anim, Math.random);
      blink = res.state;
      const frame = res.blinking ? 1 : 0;
      const bob = bobOffset(now - start, sheet.anim);
      const key = `${frame}:${bob}`;
      if (key !== painted) {
        painted = key;
        paint(frame, bob);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // ステージ・気分が変わるとアニメの時計は巻き戻るが、変わるのはセッション
    // 境界だけ（refreshLedgerViews）— 1px の呼吸の位相が一度飛ぶだけで済む。
  }, [sheet, stage, marker, stageAsset, width, height, pad]);

  return (
    <div className="tomo-presence">
      {/* canvas は姿そのもの。読み上げには「Tomoが居る」ことと今の段だけ渡す
          — ドット絵の中身を語る代替テキストは、この窓の情報ではない */}
      <canvas
        ref={canvasRef}
        className="tomo-canvas"
        width={width}
        height={height}
        role="img"
        aria-label={`Tomo（${stageAsset?.name ?? "姿"}）`}
      />
    </div>
  );
}
