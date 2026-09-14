import fs from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { MarkdownView } from "@/components/markdown/MarkdownView";

// サイト名は付けない。root layout の title.template が付ける
// (手で連結すると非本番の [LOCAL] が抜け落ちる)
export const metadata: Metadata = {
  title: "全文検索の使い方",
};

// docs/05-全文検索の使い方.md をそのままヘルプページとして表示する。
// standalone ビルドに md を含めるため next.config.ts の
// outputFileTracingIncludes とセットで管理する
export default async function SearchDocsPage() {
  const markdown = await fs.readFile(
    path.join(process.cwd(), "docs", "05-全文検索の使い方.md"),
    "utf-8",
  );
  // 見出しは md 側の h1 (# 全文検索の使い方) に任せる
  return <MarkdownView markdown={markdown} />;
}
