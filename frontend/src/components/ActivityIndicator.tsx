import { useEffect, useState } from "react";
import type { Activity } from "../activity";
import { activityLabel, formatElapsed } from "../activity";

interface ActivityIndicatorProps {
  activity: Activity;
}

/**
 * 動いているあいだ会話の末尾に出る帯 (ADR-0008)。
 *
 * 秒の刻みはこの中で閉じる: 上（App）に置くと1秒ごとにログ全体が再描画され、
 * 応答停止の修正（appendBlocks / MessageView の memo）で外したはずの費用が
 * 戻ってくる。動いているものは、動いている部品だけが持つ。
 */
export function ActivityIndicator({ activity }: ActivityIndicatorProps) {
  const [now, setNow] = useState(() => Date.now());

  // 段が変わるたびに数え直す。0.5秒刻みで見るのは、1秒ちょうどの間隔だと
  // 表示が1秒近く遅れて始まることがあるため（開始のずれの分だけ最初の "1s" が
  // 遅れて見え、止まっているように読める）。
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [activity.since]);

  const label = activityLabel(activity);
  return (
    // aria-label は chat-turn-thinking と同じ扱い: 新着として1度読まれるのは
    // 段の名前だけで、秒は読み上げから外す（1秒ごとに読み上げが走ると、
    // 待っていることの通知が待つことの妨げになる）。
    <div className="chat-activity" aria-label={label} title="本体はまだ返事を書いていない。この帯が動いている間は、窓ではなく仕事の方が続いている">
      <span className="chat-activity-pulse" aria-hidden="true" />
      <span className="chat-activity-label">{label}</span>
      <span className="chat-activity-elapsed" aria-hidden="true">
        {formatElapsed(now - activity.since)}
      </span>
    </div>
  );
}
