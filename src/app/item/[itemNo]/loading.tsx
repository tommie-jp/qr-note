import { SkeletonBox, SkeletonLine } from "@/components/Skeleton";

// /item/:itemNo の遷移中に即座に出す骨組み (docs/11-アプリ的UIUX計画.md §1-3)。
//
// 本文の枠には**一言入れる** (docs/85-回路図表示待ち計画.md §5)。骨組みの枠は
// bg-white なので、白い紙の上では点滅していても「何も起きていない」と
// 見分けが付かない — 実際「ノートが真っ白になる」として報告された。
//
// 回路図の待ちはもうここには出ない (planCircuits で本文が先に出るため)。
// ここが受け持つのは DB を引くまでの一瞬だけになった
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <SkeletonLine className="w-28" />
        <SkeletonLine className="w-32" />
      </div>
      {/* タブ + 本文 */}
      <SkeletonLine className="w-48" />
      <SkeletonBox className="h-72">ノートを読み込み中…</SkeletonBox>
    </div>
  );
}
