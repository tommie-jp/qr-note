import { SkeletonBox, SkeletonLine } from "@/components/chrome/Skeleton";

// /edit/:itemNo の遷移中に即座に出す骨組み (docs/11-アプリ的UIUX計画.md §1-3)
export default function Loading() {
  return (
    <div className="space-y-4">
      <SkeletonLine className="w-28" />
      {/* mode ラジオ */}
      <SkeletonLine className="w-40" />
      {/* memo エディタ */}
      <SkeletonBox className="h-56" />
      {/* URL 欄 */}
      <SkeletonBox className="h-20" />
      <SkeletonBox className="h-11 w-28" />
    </div>
  );
}
