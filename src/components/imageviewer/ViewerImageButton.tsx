"use client";

import type { ReactNode } from "react";
import { sameTarget, type ViewerTarget } from "@/lib/images/viewerNav";
import { isValidVideoName } from "@/lib/uploads/names";
import { useImageViewer } from "./ImageViewerProvider";

// 一覧の画像 (画像タイル・行のサムネ) を、押すとビューアが開く釦にする
// (docs/116 §1)。
//
// 置き場所は**ノートへのリンクの外**。タイル・行はリンクの ::after を枠
// いっぱいに広げた stretched link なので、relative z-10 で膜の上に出せば
// 画像だけがビューアの当たり判定になり、残り (題・余白) は今までどおり
// ノートを開く。provider の外 (オフライン一覧など) では素の画像のまま
// 膜の下に居て、押せばノートが開く
export function ViewerImageButton({
  target,
  className = "",
  dataRowThumb,
  children,
}: {
  target: ViewerTarget;
  className?: string;
  // 行のサムネのとき、その表示の寸法 (RowActions.tsx の COMPACT_PLACEMENT_CLASS)
  dataRowThumb?: string;
  children: ReactNode;
}) {
  const viewer = useImageViewer();
  if (viewer === null) {
    return <>{children}</>;
  }
  // いまビューアに出ている 1 枚。outline は中身 (img) より上に塗られるので
  // 画像に隠れない (ring の box-shadow は隠れる)
  const active = viewer.current !== null && sameTarget(viewer.current, target);
  return (
    <button
      type="button"
      // data-viewer-* … ビューアが前後を決めるための目印 (ImageViewerProvider)
      data-viewer-image={target.name}
      data-viewer-item={target.itemId}
      data-viewer-href={target.href}
      data-row-thumb={dataRowThumb}
      // 動画のタイルはビューアで再生する (docs/117 §8)
      aria-label={isValidVideoName(target.name) ? "動画を再生" : "画像を大きく表示"}
      aria-pressed={active}
      onClick={() => viewer.open(target)}
      className={`relative z-10 block cursor-zoom-in ${
        active
          ? "outline-3 -outline-offset-3 outline-[var(--row-tint-border)]"
          : ""
      } ${className}`}
    >
      {children}
    </button>
  );
}
