// loading.tsx 用の骨組み部品 (docs/11-アプリ的UIUX計画.md §1-3)。
// 中身を真似た凝った骨組みにはしない。遷移直後に「画面が変わった」ことが
// 伝わればよく、実物とずれると読み込み完了時にガタつくため

import type { ReactNode } from "react";

interface SkeletonProps {
  className?: string;
}

export function SkeletonLine({ className = "" }: SkeletonProps) {
  return <div className={`h-4 animate-pulse rounded bg-gray-200 ${className}`} />;
}

// 中身に一言添えられる。**白い枠が数秒続くと「壊れた」に見える**
// (docs/85-回路図表示待ち計画.md §5) — 枠は bg-white なので、点滅しても
// 白い紙の上では何も起きていないのと区別が付かない。
// 添える文字は使う側が決める (待たせている物が画面ごとに違うため)
export function SkeletonBox({
  className = "",
  children,
}: SkeletonProps & { children?: ReactNode }) {
  return (
    <div
      className={`flex animate-pulse items-center justify-center rounded border border-gray-200 bg-white text-gray-500 ${className}`}
    >
      {children}
    </div>
  );
}
