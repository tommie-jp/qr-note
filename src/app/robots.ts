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

// AI の学習・回答生成のためにサイトを丸ごと読んでいくクローラー
// (docs/90-クローラ対策計画.md §3)。
//
// **検索用のクローラーを混ぜないこと。** Googlebot をここに入れると
// /item の noindex が読まれなくなり、目的と逆に働く。Google-Extended と
// Applebot-Extended は「学習に使うか」だけを指す robots.txt 専用のトークンで、
// 検索用の Googlebot / Applebot とは別物なので入れてよい。
//
// 従うかどうかは相手次第 (robots.txt はお願いであって鍵ではない)。名乗らない
// スクレイパーには効かないが、主要な事業者は公表どおり従っている。
const AI_TRAINING_CRAWLERS = [
  // OpenAI (学習用の収集。ChatGPT の検索表示は OAI-SearchBot で別 UA)
  "GPTBot",
  // Common Crawl。集めた結果が各社の学習データに使われる
  "CCBot",
  // Anthropic。anthropic-ai と Claude-Web は旧称だが、古い実装が名乗るので残す
  "ClaudeBot",
  "anthropic-ai",
  "Claude-Web",
  // Google の学習用オプトアウト (Gemini / Vertex AI)
  "Google-Extended",
  // Apple の学習用オプトアウト (Apple Intelligence)
  "Applebot-Extended",
  // ByteDance
  "Bytespider",
  // Meta
  "meta-externalagent",
  // Cohere
  "cohere-ai",
  // Perplexity。学習ではなく回答生成のための取得だが、断る先は同じ
  "PerplexityBot",
] as const;

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

  // 本番/ローカル。検索エンジンは通し、AI 学習用の収集だけ断る
  // (docs/90-クローラ対策計画.md §3)。
  //
  // **`*` は allow のまま**にするのが要点。公開ノートを検索結果に出さない
  // 方針はページ側の noindex metadata (item / print) が担っており、robots.txt で
  // crawl 自体を止めると、その noindex を読んでもらえずかえってインデックスされる。
  //
  // 逆に AI 学習の収集には noindex が効かない。あれは検索インデックスへの
  // 指示であって、「読んで持ち帰る」だけの収集は素通りする。断るなら
  // robots.txt しかないので、ここに UA を並べる。
  //
  // 並び順に意味がある (デモ側と同じ理由)。包括的な `*` は最後。
  return {
    rules: [
      { userAgent: [...AI_TRAINING_CRAWLERS], disallow: "/" },
      { userAgent: "*", allow: "/" },
    ],
  };
}
