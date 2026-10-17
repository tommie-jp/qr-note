"use client";

import type { ReactNode } from "react";
import { useImageFit } from "@/lib/prefs/imageFit";

// 画像の表示モード (prefs/imageFit.ts) を本文の器へ印として立てる
// (docs/106-画像表示モード計画.md)。
//
// 効かせ方は globals.css の `[data-img-fit]` の規則で、ここは印を付けるだけ。
// 中身 (NoteBody) は Server Component のまま children で受ける。
//
// **ログイン中の画面 (ItemView) だけが包む。** 公開ビュー・オフライン表示は
// 包まないので、CSS の既定 (全体を表示) のまま描かれる
export function ImageFitScope({ children }: { children: ReactNode }) {
  const fit = useImageFit();
  return <div data-img-fit={fit}>{children}</div>;
}
