// Yahoo! の規定クレジット (docs/46-クレジット表記計画.md §1-1 / docs/94 / docs/95)。
//
// Yahoo!ショッピング API を使う画面には、この規定クレジットを表示する義務が
// ある。使うのは 2 か所 — 総覧の /about (楽天・openBD・NDL と並べる) と、
// 編集画面の下部フッター (AttributionFooter 経由)。二重管理を避けるため、
// 規定 HTML の実体はここ 1 か所に置く。
//
// **一字一句この HTML のまま出す。** 規約で改変 (CSS での色変更・極端な縮小・
// リンク先や文言の変更) が禁止されているため、JSX で組み直さず規定ソースを
// そのまま挿入する。target/rel も規定に無いので足さない。
// 最新の規定は https://developer.yahoo.co.jp/attribution/ で確認する。
const YAHOO_ATTRIBUTION_HTML =
  "<!-- Begin Yahoo! JAPAN Web Services Attribution Snippet -->\n" +
  '<span style="margin:15px 15px 15px 15px"><a href="https://developer.yahoo.co.jp/sitemap/">Webサービス by Yahoo! JAPAN</a></span>\n' +
  "<!-- End Yahoo! JAPAN Web Services Attribution Snippet -->";

// 規定クレジットを描く。与えるスタイルは text-blue-700 underline だけ —
// これは Tailwind の preflight がリンク色を inherit・下線を none に潰すのを
// 「リンクに見える」既定へ戻すためで、規定 HTML 自体には手を入れない。
// 極端な縮小 (text-xs 等) はしない (「極端に小さくしない」の趣旨)。
export function YahooAttribution() {
  return (
    // 規定 HTML をそのまま挿入する (改変禁止のため JSX で組み直さない)。
    // 静的な定数で、ユーザー入力は一切混じらない
    <div
      className="text-blue-700 underline"
      dangerouslySetInnerHTML={{ __html: YAHOO_ATTRIBUTION_HTML }}
    />
  );
}
