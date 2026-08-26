import type { MetadataRoute } from "next";
import { isDemoMode } from "@/lib/appEnv";

// robots.txt (docs/39-デモ公開計画.md §3)。
//
// force-dynamic で毎回 DEMO_MODE を評価する。robots は既定でビルド時に静的化
// されるが、デモは本番と**同一イメージ**を使い回す (docs/39 §5) ため、
// ビルド時の値 (DEMO_MODE 未設定 = allow) を焼き付けると、デモインスタンスでも
// allow を配ってしまう。起動時の env をランタイムで読むのが要
// (layout の generateMetadata を関数にしているのと同じ理由)。
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  if (isDemoMode()) {
    // デモは検索結果に載せない。guest が上げた内容を巻き込んで
    // インデックスされる事故を防ぐ。
    //
    // ただし**カード生成のクローラーだけは通す** (docs/89-OGP計画.md §5)。
    // デモは X で紹介する前提で、貼った URL にサムネを出したい。
    // インデックスとカード生成は別物で、Twitterbot が取りに来ても X の検索に
    // ページが載るわけではない — 出るのは root layout の og メタ (サイト名・
    // 説明・画像) だけなので、guest の中身は末尾の disallow が守ったまま
    // カードだけ立つ。
    //
    // **並び順に意味がある。** RFC 9309 ではクローラーは自分に最も特化した
    // UA グループ**だけ**に従うので、Twitterbot は自分の allow を見て、
    // 検索エンジンは末尾の `*` に落ちる。包括的な規則は最後に置くこと。
    return {
      rules: [
        // X (Twitter) のカード生成
        { userAgent: "Twitterbot", allow: "/" },
        // Facebook のカード生成。LINE もこの UA を名乗る。
        // (Discord・iMessage はそもそも robots.txt を見ないので不要)
        { userAgent: "facebookexternalhit", allow: "/" },
        { userAgent: "*", disallow: "/" },
      ],
    };
  }

  // 本番/ローカルは全許可。公開ノートを検索エンジンに載せない方針は
  // ページ側の noindex metadata (item / print) が担う。robots.txt で crawl 自体を
  // 止めると、その noindex を読んでもらえなくなるため、ここは許可が正しい。
  return { rules: { userAgent: "*", allow: "/" } };
}
