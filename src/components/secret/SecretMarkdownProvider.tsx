"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import {
  type RenderSecretMarkdown,
  SecretMarkdownContext,
} from "./SecretMarkdown";

// SecretBlock が開いた断片の中身を描く MarkdownView を、ここから差し込む
// (SecretMarkdown.tsx の注)。MarkdownView は**動的に読む**。理由は 2 つ:
//
// - MarkdownView 側が img から SecretBlock へ振り分けるため、SecretBlock から
//   静的 import すると循環参照になる (どちらかが評価途中の undefined を掴みうる)。
// - react-markdown + KaTeX 一式は重い。断片を開くまで読み込まなければ、
//   シークレットを使わないノートの表示は今までどおり軽いまま
//   (DrawModal / ScannerModal と同じ流儀)。
const MarkdownView = dynamic(
  () => import("@/components/markdown/MarkdownView").then((m) => m.MarkdownView),
  { ssr: false, loading: () => null },
);

// module の関数なので参照は変わらない (context の購読側が描き直されない)
const renderSecretMarkdown: RenderSecretMarkdown = (props) => (
  <MarkdownView {...props} />
);

export function SecretMarkdownProvider({ children }: { children: ReactNode }) {
  return (
    <SecretMarkdownContext.Provider value={renderSecretMarkdown}>
      {children}
    </SecretMarkdownContext.Provider>
  );
}
