import { YahooAttribution } from "./YahooAttribution";

// このアプリが使っている Web サービスの「適切なページ」への導線 (docs/95)。
//
// **URL の出どころをここ 1 か所にする。** /about (総覧) とエディタ下部の
// 帰属フッターの両方から参照し、リンク先がズレないようにする (二重管理だと
// 片方だけ古くなる)。ラベルと体裁は使う側が各所で持つ。
//
// 楽天は汎用トップではなく、実際に叩いている「楽天ブックス書籍検索API」
// (version 2017-04-04、コードの BooksBook/Search/20170404 と一致) のドキュメント
// を指す。国会・openBD は利用者向けに素直なトップ。
// Yahoo! は規約で規定 HTML が固定なので、ここには入れず YahooAttribution が持つ。
export const SERVICE_LINKS = {
  rakutenBooks: {
    label: "楽天ブックス書籍検索API",
    href: "https://webservice.rakuten.co.jp/documentation/books-book-search",
  },
  openBd: {
    label: "openBD",
    href: "https://openbd.jp/",
  },
  ndlSearch: {
    label: "国立国会図書館サーチ",
    href: "https://ndlsearch.ndl.go.jp/",
  },
} as const;

// 編集画面の下部に置く帰属フッター (docs/95)。JAN 商品情報 (Yahoo) の結果が
// 実際に現れる画面で、書名・著者・書影・商品情報の出典をその場で辿れるように、
// 使っている全サービスへの導線を並べる。
//
// Yahoo! は規約で表示が義務なので規定 HTML をそのまま (YahooAttribution)。
// 他社は義務ではないので、体裁を揃えた普通のリンクにする。極端に縮小しない
// (text-sm 止まり) のは Yahoo の「極端に小さくしない」に他社もそろえるため。
export function AttributionFooter() {
  return (
    <div className="space-y-2 border-t border-gray-200 pt-4 text-gray-500">
      <YahooAttribution />
      <p className="text-sm">
        データ提供:{" "}
        {Object.values(SERVICE_LINKS).map((service, index) => (
          <span key={service.href}>
            {index > 0 ? " / " : null}
            <a
              href={service.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 underline"
            >
              {service.label}
            </a>
          </span>
        ))}
      </p>
    </div>
  );
}
