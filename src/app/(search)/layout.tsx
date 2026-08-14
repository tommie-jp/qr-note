// 検索 3 ペインの layout (docs/86 §2)。検索ページ (children) と、/item への
// ソフト遷移を横取りしたプレビュー (@detail スロット) を並べるだけ。
//
// 器の見た目 (全画面オーバーレイ / 下部ペイン) はスロットの中 (PreviewPane)
// が持つ。layout はスロットが null (未選択) かどうかを知らないので、ここに
// 枠を書くと未選択時に空の枠が出てしまう
export default function SearchLayout({
  children,
  detail,
}: {
  children: React.ReactNode;
  detail: React.ReactNode;
}) {
  return (
    <>
      {children}
      {detail}
    </>
  );
}
