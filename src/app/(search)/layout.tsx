import { cookies } from "next/headers";
import { PaneModeProvider } from "@/components/PaneModeProvider";
import { PANE_MODE_COOKIE, parsePaneMode } from "@/lib/paneMode";

// 検索 3 ペインの layout (docs/86 §2)。検索ページ (children) と、/item への
// ソフト遷移を横取りしたノート (@detail スロット) を並べるだけ。
//
// 器の見た目 (全画面オーバーレイ / 下部ペイン) はスロットの中 (PreviewPane)
// が持つ。layout はスロットが null (未選択) かどうかを知らないので、ここに
// 枠を書くと未選択時に空の枠が出てしまう。
//
// 両方を PaneModeProvider で包むのが要点 (docs/86 §4-4) — ペイン構成と
// 「いまどのノートが出ているか」を、一覧側 (children) とノート側 (detail)
// の**どちらからも**見えるようにするため。
export default async function SearchLayout({
  children,
  detail,
}: {
  children: React.ReactNode;
  detail: React.ReactNode;
}) {
  const mode = parsePaneMode((await cookies()).get(PANE_MODE_COOKIE)?.value);

  return (
    <PaneModeProvider mode={mode}>
      {children}
      {detail}
    </PaneModeProvider>
  );
}
