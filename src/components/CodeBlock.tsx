"use client";

import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { OVERLAY_BUTTON_CLASS } from "./ui";

// コピーできた印を出しておく時間
const COPIED_LABEL_MS = 2000;

type CopyState = "idle" | "copied" | "failed";

interface CodeBlockProps extends ComponentProps<"pre"> {
  children: ReactNode;
}

// コードブロックにコピーボタンを添える (docs/54-markdown表示拡張計画.md §1)。
// iPhone でコードブロックだけを範囲選択するのは難しく、長いコマンドや OCR で
// 取り込んだ文字を取り出す手立てが実質なかった。
//
// ボタンは常に出す。navigator.clipboard が無い経路 (secure context 以外) は
// 押した時点で失敗として文言を出す — 出し分けを mount 後まで待つと、
// ボタンが後から生えてきて画面が跳ねる
export function CodeBlock({ children, ...props }: CodeBlockProps) {
  const [state, setState] = useState<CopyState>("idle");
  const pre = useRef<HTMLPreElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = async () => {
    // **表示している文字をそのまま読む。** 同じ中身を prop でも受け取ると、
    // MarkdownView は Server Component なのでコードがサーバ→クライアントの
    // ペイロードに 2 部乗る
    const code = pre.current?.textContent?.trimEnd() ?? "";
    try {
      await navigator.clipboard.writeText(code);
      // 続けて押されたときに、前の印の後始末で先に消えないようにする
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
      setState("copied");
      timer.current = setTimeout(() => setState("idle"), COPIED_LABEL_MS);
    } catch (cause) {
      console.error("コードをコピーできませんでした", cause);
      setState("failed");
    }
  };

  return (
    <div className="relative">
      <pre ref={pre} {...props}>
        {children}
      </pre>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="コードをコピー"
        // 背景は共有スキンの bg-white のまま。半透明にすると下のコードが
        // 透けて文字が重なり、かえって読みにくい
        className={`absolute right-2 top-2 ${OVERLAY_BUTTON_CLASS} print:hidden`}
      >
        {state === "copied" ? "✓ コピー済" : "コピー"}
      </button>
      {state === "failed" && (
        <p className="mt-1 text-sm text-red-700">コピーできませんでした</p>
      )}
    </div>
  );
}
