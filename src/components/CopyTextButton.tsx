"use client";

import { useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "@/components/icons";
import { COMPACT_ICON_BUTTON_CLASS } from "@/components/ui";
import { errorText } from "@/lib/errorMessage";

// コピーできた印を出しておく時間 (components/markdown/CodeBlock.tsx と同じ長さ)
const COPIED_LABEL_MS = 2000;

type CopyState = "idle" | "copied";

interface CopyTextButtonProps {
  // サーバで整形済みのプレーンテキスト。中身は DOM から読まずに prop で受ける
  // — 調査のときだけ開く画面なので、マークアップの形に寄りかからない単純さを取る
  text: string;
  // 何をコピーするか (「ログ」「サーバー情報」)。aria-label / title / 失敗の
  // 文言に入る。アイコンだけのボタンなので、名前はここでしか名乗れない
  subject: string;
}

// 画面の中身をまとめてコピーするアイコンボタン (docs/21-ログ表示計画.md §6)。
// 実機調査では、出た内容を手元 (PC のメモ・チャット) に移して読み解きたい。
// iPhone で長い一覧を範囲選択するのは実質できないため、ボタンで渡す。
//
// もとは /logs 専用の CopyLogsButton だった。サーバー情報 (docs/109) でも
// 同じ釦が要るので、名乗り (subject) だけ受け取る形に一般化した。
//
// useRouter は使わない: /logs の ClearLogsButton と同じ理由で、静的描画テスト
// (page.test.tsx) が router のマウントを要求して壊れる。
//
// 見た目はアイコンだけの正方形。文字を置かないので、意味は aria-label / title
// で名乗る — 押した後の「済んだ」の合図も、文字の差し替えではなくアイコンの
// 差し替え (CopyIcon → CheckIcon) で出す。ラベルの文字数が変わるとボタンの
// 幅が動き、隣のボタンの位置がずれる
export function CopyTextButton({ text, subject }: CopyTextButtonProps) {
  const [state, setState] = useState<CopyState>("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = async () => {
    setError(null);
    // 前の印の後始末を先に済ませる。成功時は「続けて押されたときに前の
    // タイマーで先に消える」のを防ぎ、失敗時は前回の ✓ が残って
    // 「済んだ印 + 失敗の文言」が並ぶのを防ぐ
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setState("idle");
    try {
      // navigator.clipboard が無い経路 (secure context 以外) は押した時点で
      // 失敗として文言を出す。出し分けを mount 後まで待つと、ボタンが後から
      // 生えてきて画面が跳ねる
      await navigator.clipboard.writeText(text);
      setState("copied");
      timer.current = setTimeout(() => setState("idle"), COPIED_LABEL_MS);
    } catch (cause) {
      // 理由まで画面に出す。ここで console.error を使うとログ自身が 1 件
      // 増える (logBuffer が console を包んでいる) ため、失敗の記録は画面だけに留める
      setError(`${subject}をコピーできませんでした (${errorText(cause)})`);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <span role="alert" className="text-sm text-red-700">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={() => void copy()}
        // 空のときに押せると、貼り先に何も入らないのを「壊れた」と読んでしまう
        disabled={text.length === 0}
        aria-label={
          state === "copied" ? `${subject}をコピーしました` : `${subject}をコピー`
        }
        title={`${subject}をコピー`}
        className={COMPACT_ICON_BUTTON_CLASS}
      >
        {state === "copied" ? <CheckIcon /> : <CopyIcon />}
      </button>
    </span>
  );
}
