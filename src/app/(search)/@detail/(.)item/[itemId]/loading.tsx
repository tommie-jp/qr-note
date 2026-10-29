import { PendingNoteFrame } from "@/components/panes/PendingNoteFrame";
import { PreviewPane } from "@/components/panes/PreviewPane";
import { isDemoMode, isProductionEnv } from "@/lib/appEnv";

// プレビューの読み込み中も器 (PreviewPane) ごと出す。骨組みだけを流すと、
// ペインの外 (一覧の下) に骨組みが素で並んでしまう。中身は押した行の題と
// 本文の骨組み (PendingNoteFrame。docs/86 §4-18・docs/11 §1-3)
export default function Loading() {
  return (
    <PreviewPane bgClass={isProductionEnv() ? "bg-gray-50" : "bg-pink-50"}>
      <PendingNoteFrame isDemo={isDemoMode()} />
    </PreviewPane>
  );
}
