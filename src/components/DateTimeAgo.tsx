"use client";

import { formatJstDateTimeAgo } from "@/lib/datetime";
import { useNow } from "@/lib/client/useNow";

// 「2026/11/17 19:52:45(5分前)」。相対は描き終えてから付け、開いたままでも進む。
// Server Component の画面から日時を出すときに使う (Date は ISO 文字列で渡す)
export function DateTimeAgo({ iso }: { iso: string }) {
  const now = useNow();
  return <>{formatJstDateTimeAgo(new Date(iso), now)}</>;
}
