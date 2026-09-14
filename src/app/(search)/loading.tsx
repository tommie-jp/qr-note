import { SkeletonBox, SkeletonLine } from "@/components/chrome/Skeleton";

// / の遷移中に即座に出す骨組み (docs/11-アプリ的UIUX計画.md §1-3)。
//
// (search) のルートグループに入れているのは、app/loading.tsx に置くと
// 自前の loading を持たないページ (/print・/docs) にまで検索の骨組みが
// 出てしまうため。URL は / のまま変わらない。
export default function Loading() {
  return (
    <div className="space-y-4">
      {/* 検索窓 + スキャンボタン */}
      <div className="flex gap-2">
        <SkeletonBox className="h-11 flex-1" />
        <SkeletonBox className="h-11 w-24" />
      </div>
      {/* 件数と並び替え */}
      <div className="flex justify-between">
        <SkeletonLine className="w-40" />
        <SkeletonLine className="w-28" />
      </div>
      {/* 一覧 (1 ページ 20 件だが、画面に入る分だけ出せば十分) */}
      <SkeletonBox className="h-96" />
    </div>
  );
}
