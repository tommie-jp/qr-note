interface ItemUrlBoxProps {
  url: string;
}

// ノートの URL 欄 (mode=url のノートの本体)。持ち主の画面と公開ビューで
// 同じものを出すため切り出した。
//
// rel="noreferrer" … 外部サイトへ飛ぶとき、どのノートから来たかを
// Referer で渡さない (公開ビューでは特に、リンク先に閲覧の事実を渡さない)
export function ItemUrlBox({ url }: ItemUrlBoxProps) {
  return (
    <p className="rounded bg-blue-50 px-3 py-2">
      URL:{" "}
      <a href={url} className="break-all text-blue-600 underline" rel="noreferrer">
        {url}
      </a>
    </p>
  );
}
