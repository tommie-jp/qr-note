import { PreviewPane } from "@/components/PreviewPane";
import { SkeletonBox, SkeletonLine } from "@/components/Skeleton";
import { isProductionEnv } from "@/lib/appEnv";

// プレビューの読み込み中も器 (PreviewPane) ごと出す。骨組みだけを流すと、
// ペインの外 (一覧の下) に骨組みが素で並んでしまう。中身は
// item/[itemNo]/loading.tsx と同じ意図の骨組み (docs/11 §1-3)
export default function Loading() {
  return (
    <PreviewPane bgClass={isProductionEnv() ? "bg-gray-50" : "bg-pink-50"}>
      <div className="space-y-4">
        <SkeletonLine className="w-28" />
        <SkeletonBox className="h-72">ノートを読み込み中…</SkeletonBox>
      </div>
    </PreviewPane>
  );
}
