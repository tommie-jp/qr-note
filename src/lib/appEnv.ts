// ローカル (http://127.0.0.1:3000) を本番と勘違いしてデータを更新する事故が
// 続いたため、非本番の画面はピンクに塗って一目で見分けられるようにする。
// ここがその判定の唯一の出どころ。

// 「APP_ENV=production を明示したときだけ本番」とし、それ以外はすべて非本番扱いに倒す。
// 設定漏れ・新しい起動方法・ポートフォワード経由といった想定外の経路が
// すべて「ピンクになる (実害なし)」側に落ちるようにするため。逆向きに倒すと、
// 想定外の経路がそのまま本番の見た目になり、防ぎたかった事故がそのまま起きる。
//
// NODE_ENV は使わない。doStart.sh (ローカルを docker compose で本番相当に起動) や
// `next build && next start` は NODE_ENV=production になるが、その経路こそが
// 127.0.0.1:3000 を本番そっくりに見せている当人であり、警告を消してはいけない。
//
// ホスト名 (headers() の host) でも判定しない。0.0.0.0 で起動して LAN の別名で
// 開く・トンネル経由で開くなどですり抜けるうえ、判定漏れが本番側に倒れる。
export function isProductionEnv(): boolean {
  return process.env.APP_ENV === "production";
}

// 隔離デモインスタンス (別スタック + 定期再シード。docs/38-デモモード計画.md) の
// ときだけ true。guest に書き込みを許す代わりに、公開機能・設定系・大きい
// アップロードを閉じ、デモである旨を画面に出す。判定はここが唯一の出どころ。
//
// isProductionEnv() とは倒れる向きが逆であることに注意する。あちらは「設定漏れは
// ピンク (実害なし) へ倒す」が、こちらは**旗の欠落が「デモ保護オフ」へ倒れる**。
// デモスタックを立てるときに DEMO_MODE を渡し忘れると、無防備な書き込み可サイトに
// なってしまう。対策として compose の override に直書きする (docs/38 §7)。
//
// "1" の完全一致だけを有効とする。"true"/"yes" などの解釈揺れを作らない
// (isProductionEnv が "production" 完全一致なのと同じ流儀)。
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1";
}

// NODE_ENV が production か。**isProductionEnv とは別の問い**で、`next build` /
// `next start` と Docker のコンテナは production、`next dev` とテストはそれ以外に
// なる (上のコメントのとおり、ローカルを本番相当に起動した経路も production)。
// 「本番サイトか」ではなく「開発サーバでないか」を見たいとき — HTTPS 前提の
// cookie の secure や、ホットリロード対策の要否 — にだけ使う。
export function isNodeEnvProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

// --- サーバの設定値 (docs/93-リファクタリング計画.md §3-1) ---
//
// process.env の読み口をここに集める。どれも**呼ばれた時点で**読み、生の値を
// そのまま返す。空文字を既定へ倒す・欠けを名指しするといった解釈は、理由を
// 知っている使う側に残す (site.ts の `||` など)。
//
// このファイルはブラウザの束にも入る (uploads.ts 経由) が、NEXT_PUBLIC_ で
// 始まらない env はビルド時に埋め込まれない。ブラウザで呼んでも undefined に
// なるだけで値は漏れないので、画面に要る値はサーバコンポーネントから props で
// 降ろす (Next.js の environment-variables.md)。
//
// ここを通さない読みが 3 つある:
//   - instrumentation.ts の NEXT_RUNTIME … ランタイムごとの束から、そのランタイムで
//     動かない import を落とす手がかり (Next.js の instrumentation.md の作法)。
//     ビルド時に埋め込まれる前提の書き方で、関数の奥へ隠すと意味が変わる
//   - offline/register.ts の NODE_ENV … ブラウザ専用のモジュールで、ビルド時に
//     埋め込まれる値を読む
//   - embedding/embedder.ts の TMPDIR … ブラウザとサーバの両方で動くモジュールの
//     サーバ側の枝

// Prisma の接続先 (db.ts)
export function databaseUrlEnv(): string | undefined {
  return process.env.DATABASE_URL;
}

// サイトの URL の起点 (site.ts の qrBaseUrl が既定へ倒して使う)
export function qrBaseUrlEnv(): string | undefined {
  return process.env.QR_BASE_URL;
}

// ログインの資格情報 (auth.ts。ハッシュを base64 で持つ理由はそちら)
export function basicAuthEnv(): {
  user: string | undefined;
  hashB64: string | undefined;
} {
  return {
    user: process.env.BASIC_AUTH_USER,
    hashB64: process.env.BASIC_AUTH_HASH_B64,
  };
}

// パスキーの rpID と origin (webauthnConfig.ts。docs/29-パスキー計画.md §7)
export function webauthnEnv(): {
  rpId: string | undefined;
  origin: string | undefined;
} {
  return {
    rpId: process.env.WEBAUTHN_RP_ID,
    origin: process.env.WEBAUTHN_ORIGIN,
  };
}

// JAN の商品情報を引く Yahoo!ショッピングの Client ID (yahooShopping.ts)
export function yahooShoppingAppIdEnv(): string | undefined {
  return process.env.YAHOO_SHOPPING_APP_ID;
}

// ISBN の書影を引く楽天ブックスの資格情報 (rakutenBooks.ts。3 つ揃って使える)
export function rakutenBooksEnv(): {
  appId: string | undefined;
  accessKey: string | undefined;
  origin: string | undefined;
} {
  return {
    appId: process.env.RAKUTEN_APP_ID,
    accessKey: process.env.RAKUTEN_ACCESS_KEY,
    origin: process.env.RAKUTEN_APP_ORIGIN,
  };
}

// ノート履歴の git リポジトリの置き場 (git/notesRepo.ts。テストが一時
// ディレクトリへ向ける)
export function qrGitDirEnv(): string | undefined {
  return process.env.QR_GIT_DIR;
}

// git 子プロセスへ引き継ぐ PATH (git/notesRepo.ts の gitEnv)
export function pathEnv(): string | undefined {
  return process.env.PATH;
}

// デモのログイン案内 (layout.tsx の DemoBanner。docs/39 §4)
export function demoLoginHintEnv(): string | undefined {
  return process.env.DEMO_LOGIN_HINT;
}

// 非本番の目印に使う色。ヘッダは Tailwind のクラスで塗る一方、
// meta[theme-color] と PWA manifest は hex の直値しか受け取らないため、
// 対応する hex をここに控えて両者がずれないようにする。
// (themeColor = ヘッダの色、backgroundColor = body の色)
export const LOCAL_THEME_COLOR = "#fce7f3"; // bg-pink-100 相当
export const LOCAL_BACKGROUND_COLOR = "#fdf2f8"; // bg-pink-50 相当
export const PROD_THEME_COLOR = "#ffffff"; // ヘッダ白
export const PROD_BACKGROUND_COLOR = "#f9fafb"; // bg-gray-50 相当
