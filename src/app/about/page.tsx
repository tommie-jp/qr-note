import type { Metadata } from "next";
import { SERVICE_LINKS } from "@/components/AttributionFooter";
import { YahooAttribution } from "@/components/YahooAttribution";

// クレジット / 帰属表示のページ (docs/46-クレジット表記計画.md)。
//
// **設定系 (パスキー等) と違い、デモでも隠さず・ログイン前でも見せてよい。**
// Yahoo!デベロッパーネットワークはクレジット表示が義務で、外部 API を使う
// 事実は誰に対しても表示してよい情報なので、requireUser() も notFound() も
// 掛けない。
//
// サイト名は付けない。root layout の title.template が付ける
export const metadata: Metadata = {
  title: "クレジット",
};

// このアプリが使う Web サービスの帰属表示 (docs/46 §1)。
export default function AboutPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-bold">クレジット</h1>
        <p className="text-gray-600">
          本アプリは、書籍・商品情報の取得に以下の Web
          サービスを利用しています。
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="font-bold">Yahoo!ショッピング (JAN 商品情報)</h2>
        <p className="text-gray-600">
          JAN コードからの商品名・ブランドの取得に、Yahoo!ショッピング商品検索
          API を利用しています。
        </p>
        <YahooAttribution />
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">楽天ブックス (書影)</h2>
        <p className="text-gray-600">
          書影 (カバー画像) の取得に、
          {/* 汎用トップではなく、実際に叩いている書籍検索 API のドキュメントへ
              (URL は SERVICE_LINKS に集約。docs/95) */}
          <a
            href={SERVICE_LINKS.rakutenBooks.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline"
          >
            {SERVICE_LINKS.rakutenBooks.label}
          </a>
          を利用しています。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">openBD / 国立国会図書館サーチ (書誌)</h2>
        <p className="text-gray-600">
          書名・著者などの書誌情報は、
          <a
            href={SERVICE_LINKS.openBd.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline"
          >
            {SERVICE_LINKS.openBd.label}
          </a>
          および
          <a
            href={SERVICE_LINKS.ndlSearch.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline"
          >
            {SERVICE_LINKS.ndlSearch.label}
          </a>
          の提供データを利用しています。
        </p>
      </section>
    </div>
  );
}
