"use client";

import Link from "next/link";
import {
  PageNextIcon,
  PagePrevIcon,
  PauseIcon,
  PlayIcon,
} from "@/components/icons";
import { IMAGE_OVERLAY_BUTTON_CLASS } from "@/components/ui";
import {
  nextSlideshowInterval,
  setSlideshowInterval,
  useSlideshowInterval,
} from "@/lib/prefs/slideshowInterval";

// ペインと覆いが共有する操作の釦 (docs/116 §3)。地が暗い所に置くので
// どれも拡大表示と同じ白い丸 (IMAGE_OVERLAY_BUTTON_CLASS)。
// 覆いは「どこを押しても閉じる」ので、釦の側で伝播を止める

const ROUND_CLASS = `${IMAGE_OVERLAY_BUTTON_CLASS} inline-flex min-h-11 min-w-11 items-center justify-center`;

export function StepButton({
  dir,
  onStep,
  className = "",
}: {
  dir: -1 | 1;
  onStep: (dir: -1 | 1) => void;
  className?: string;
}) {
  const label = dir === -1 ? "前の画像" : "次の画像";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onStep(dir);
      }}
      className={`${ROUND_CLASS} ${className}`}
    >
      {dir === -1 ? <PagePrevIcon /> : <PageNextIcon />}
    </button>
  );
}

// その画像のノートへ。ソフト遷移なので 2 / 3 ペインではノートのペインに、
// 1 ペインでは全画面のノートに横取りされて開く (docs/86 §2)。
// 開くのが「いまペインに出ているノート」だと出ているノートが変わらず
// ビューアが引っ込まないので、押した時点で自分から閉じる
export function OpenNoteLink({
  href,
  onClose,
}: {
  href: string;
  onClose: () => void;
}) {
  return (
    <Link
      href={href}
      transitionTypes={["nav-forward"]}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      className={`${ROUND_CLASS} px-4 text-sm font-medium whitespace-nowrap`}
    >
      ノートを開く
    </Link>
  );
}

// スライドショーの再生 / 一時停止 (docs/117)。名前は「いま押すと何が起きるか」
export function PlayPauseButton({
  playing,
  onToggle,
  className = "",
}: {
  playing: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const label = playing ? "スライドショーを止める" : "スライドショー";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`${ROUND_CLASS} ${className}`}
    >
      {playing ? <PauseIcon /> : <PlayIcon />}
    </button>
  );
}

// 送る間隔。押すたびに 3 → 5 → 10 秒と回り、端末に覚える
// (prefs/slideshowInterval.ts)。再生中に変えれば、いま出ている 1 枚からその場で効く
export function IntervalButton() {
  const seconds = useSlideshowInterval();
  return (
    <button
      type="button"
      aria-label={`送る間隔 ${seconds} 秒`}
      title="送る間隔 (押すと変わる)"
      onClick={(e) => {
        e.stopPropagation();
        setSlideshowInterval(nextSlideshowInterval(seconds));
      }}
      className={`${ROUND_CLASS} px-3 text-sm font-medium tabular-nums whitespace-nowrap`}
    >
      {seconds}秒
    </button>
  );
}

export { ROUND_CLASS as VIEWER_ROUND_BUTTON_CLASS };
