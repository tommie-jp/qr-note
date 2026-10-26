"use client";

import Link from "next/link";
import { PageNextIcon, PagePrevIcon } from "@/components/icons";
import { IMAGE_OVERLAY_BUTTON_CLASS } from "@/components/ui";

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

export { ROUND_CLASS as VIEWER_ROUND_BUTTON_CLASS };
