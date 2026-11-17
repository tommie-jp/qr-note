"use client";

import { createContext, type ReactNode, useContext } from "react";

// 復号した断片の中身を描く部品 (= MarkdownView) の受け口。
//
// MarkdownView は img からシークレット断片を SecretBlock へ振り分け、SecretBlock は
// 開いた中身を MarkdownView で描く。互いに import すると循環になる
// (docs/128 §3-4。動的 import でも依存としては残る) ので、SecretBlock は
// MarkdownView を直接知らず、この context から受け取る。中身を差し込むのは
// layout の SecretMarkdownProvider (MarkdownView を next/dynamic で開くまで読まない)。
//
// MarkdownView 自体は公開ビューの RSC でも描かれ、そこでは createContext が
// 使えない (react-server 版に無い)。だから context は MarkdownView ではなく
// 端末側のこの葉の部品と、layout の Provider だけが触る。
export interface SecretMarkdownProps {
  markdown: string;
  linkTags: boolean;
  blobKinds: ReadonlyMap<string, "image" | "audio" | "video">;
}

// 部品ではなく「描く関数」で渡す。context から受け取った部品をそのまま
// <View /> と書くと、描画のたびに種類が変わりうる部品として lint
// (react-hooks/static-components) に止められる
export type RenderSecretMarkdown = (props: SecretMarkdownProps) => ReactNode;

export const SecretMarkdownContext = createContext<RenderSecretMarkdown | null>(
  null,
);

// 開いた断片の中身を描く。Provider の外で使われたら握りつぶさず気付けるようにする
// (layout が全ページを包むので、通常は必ず内側にいる)
export function SecretMarkdown(props: SecretMarkdownProps) {
  const render = useContext(SecretMarkdownContext);
  if (render === null) {
    throw new Error(
      "SecretMarkdown は SecretMarkdownProvider の内側で使って下さい",
    );
  }
  return render(props);
}
