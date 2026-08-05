import type { ReactNode } from "react";
import type { AlertType } from "@/lib/markdownAlerts";

// アラート (`> [!NOTE]`) の見た目 (docs/54-markdown表示拡張計画.md §2)。
// 色は GitHub に合わせる — 同じ記法を GitHub にも貼るので、見え方が揃っていた
// ほうが読み手の迷いが少ない。
//
// サニタイズの後に React が組み立てる要素なので、許可リスト (sanitizeSchema) は
// 要らない。刻まれた class から種類を読むところまでが remarkAlerts の仕事で、
// ここから先は表示だけ
const ALERT_STYLES: Record<
  AlertType,
  { label: string; icon: string; className: string }
> = {
  note: {
    label: "ノート",
    icon: "ℹ️",
    className: "border-blue-500 bg-blue-50 text-blue-900",
  },
  tip: {
    label: "ヒント",
    icon: "💡",
    className: "border-green-600 bg-green-50 text-green-900",
  },
  important: {
    label: "重要",
    icon: "❗",
    className: "border-purple-500 bg-purple-50 text-purple-900",
  },
  warning: {
    label: "注意",
    icon: "⚠️",
    className: "border-amber-500 bg-amber-50 text-amber-900",
  },
  caution: {
    label: "警告",
    icon: "🚨",
    className: "border-red-500 bg-red-50 text-red-900",
  },
};

interface MarkdownAlertProps {
  type: AlertType;
  children: ReactNode;
}

export function MarkdownAlert({ type, children }: MarkdownAlertProps) {
  const { label, icon, className } = ALERT_STYLES[type];
  return (
    // blockquote ではなく div で描く。prose の引用の飾り (縦線・斜体) が
    // 二重に付くのを避けるため
    <div className={`my-4 rounded border-l-4 px-3 py-2 ${className}`}>
      <p className="mb-1 flex items-center gap-1.5 font-medium">
        {/* 絵文字は飾り。読み上げは隣の文字で足りる */}
        <span aria-hidden="true">{icon}</span>
        {label}
      </p>
      {/* 最後の段落の下余白を詰めて、枠の中の空きを揃える */}
      <div className="[&>*:last-child]:mb-0">{children}</div>
    </div>
  );
}
