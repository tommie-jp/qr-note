// ループバック IP で開かれたときに localhost へ送り直す判定
// (docs/29-パスキー計画.md §7)。
//
// **パスキーは 127.0.0.1 では使えない。** WebAuthn の rpID は「ドメイン名」で
// なければならず、IP アドレスは指定できない (ループバックが安全な文脈として
// 扱われるかどうかとは別の話)。つまり同じアプリでも、127.0.0.1:3000 で開くと
// 登録もログインもできず、localhost:3000 で開くとできる。
//
// にもかかわらず、VS Code (WSL2) のポート転送通知の「Open in Browser」は
// **必ず 127.0.0.1 を開く**。これは既知の制限で、設定では変えられない:
//   https://github.com/microsoft/vscode/issues/304355
//   https://github.com/microsoft/vscode-remote-release/issues/2711
//
// 毎回アドレス欄を手で直すのは忘れるので、アプリ側で送り直す。
//
// この階層は next/server に触らない (値を受け取って行き先を返すだけ)。
// 実際に転送するのは proxy.ts。

// **判定は Host ヘッダで行う。** request.nextUrl は使えない —
// Next.js があれを localhost に正規化してしまうため、127.0.0.1 で開いても
// nextUrl.hostname は 'localhost' になる (実測で確認)。
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '[::1]', '::1'])

export function loopbackRedirectUrl(
  hostHeader: string | null,
  url: URL,
  isProduction: boolean,
): string | null {
  // 本番では**常に転送しない**。アプリの前に nginx が居て、アプリ自身は
  // 0.0.0.0 しか見えていない。ここで host を信じて絶対 URL を組むと、
  // login/route.ts が絶対 URL の redirect をやめた理由 (実測で
  // http://0.0.0.0:3100/... が出た) をそのまま踏み直すことになる
  if (isProduction || hostHeader === null) {
    return null
  }

  // '127.0.0.1:3000' や '[::1]:3000' を分解する。IPv6 の角括弧まで
  // 正しく扱いたいので、自前で ':' を切らず URL に解釈させる
  let parsed: URL
  try {
    parsed = new URL(`http://${hostHeader}`)
  } catch {
    // Host ヘッダは外から来る値。壊れていても投げずに「転送しない」へ倒す
    return null
  }

  if (!LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
    return null
  }

  // ポートは Host ヘッダのものを使う (nextUrl 側は当てにしない)。
  // パスとクエリはそのまま引き継ぎ、変えるのはホスト名だけ
  const port = parsed.port === '' ? '' : `:${parsed.port}`
  return `${url.protocol}//localhost${port}${url.pathname}${url.search}`
}
