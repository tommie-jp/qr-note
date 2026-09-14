import { formatJstDateTime } from "@/lib/datetime";

interface ItemTimestampsProps {
  item: { createdAt: Date; updatedAt: Date } | null;
}

// 作成/更新のタイムスタンプ表示。サーバの TZ に依存しないよう JST 固定・ゼロ埋め。
// font-mono で固定幅にし、ゼロ埋め済みの日時が 2 行で桁揃いになるようにする
export function ItemTimestamps({ item }: ItemTimestampsProps) {
  return (
    <div className="font-mono text-sm text-gray-500">
      <div>作成: {item ? formatJstDateTime(item.createdAt) : "未作成"}</div>
      <div>更新: {item ? formatJstDateTime(item.updatedAt) : ""}</div>
    </div>
  );
}
