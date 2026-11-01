import { cookies } from "next/headers";
import { ImageViewerProvider } from "@/components/imageviewer/ImageViewerProvider";
import { paneBgClass } from "@/components/item/ItemDetail";
import { ClientNotePane } from "@/components/panes/ClientNotePane";
import { PaneModeProvider } from "@/components/panes/PaneModeProvider";
import { isDemoMode } from "@/lib/appEnv";
import { PANE_MODE_COOKIE, parsePaneMode } from "@/lib/prefs/paneMode";
import { SORT_COOKIE } from "@/lib/prefs/sortMode";
import { parseSort } from "@/lib/validation";

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
  const cookieStore = await cookies();
  const mode = parsePaneMode(cookieStore.get(PANE_MODE_COOKIE)?.value);
  const cookieSort = parseSort(cookieStore.get(SORT_COOKIE)?.value);

  return (
    <PaneModeProvider mode={mode}>
      {/* 一覧の画像を大きく見せるビューア (docs/116)。ペインの構成と
          「いま出ているノート」を見るので PaneModeProvider の内側に置く */}
      <ImageViewerProvider>
        {children}
        {detail}
        {/* 一覧から開いたノートの器 (docs/123 §12)。URL から端末で描く。
            横取りスロット (detail) は旧番号の解決だけを受け持つ */}
        <ClientNotePane bgClass={paneBgClass()} isDemo={isDemoMode()} cookieSort={cookieSort} />
      </ImageViewerProvider>
    </PaneModeProvider>
  );
}
