// 全応答に付けるセキュリティヘッダ (2026-11 の監査 M-1)。next.config.ts の
// headers() から読む。ここに置くと本番 (nginx)・デモ・ローカル (Caddy / next dev)
// のどれでも同じ値になり、エッジと二重管理にならない。
//
// HSTS だけはここに**無い**。HTTPS でしか意味がなく、本番・デモの nginx は
// ホスト共通の nginx.conf が `add_header Strict-Transport-Security … always` を
// 全サイトに付けている (vps1 / vps2 とも実測)。サイトの conf に add_header を
// 1 行でも書くと nginx はホスト共通の分を継承しなくなるので、サイト側には書かない。
//
// CSP はここではなく proxy.ts (要求ごとの nonce が要るため。lib/security/csp.ts)。
//
// next.config.ts から読まれるので、このファイルは副作用のない定数だけにすること
// (uploads/limits.ts と同じ制約)
export interface HeaderPair {
  readonly key: string
  readonly value: string
}

export const SECURITY_HEADERS: readonly HeaderPair[] = [
  // ユーザー由来のバイト列 (添付・SVG) を配るので、全応答で MIME の推測を禁じる
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // 外部リンクと外部画像 (直リンク) にはオリジンだけ渡す。/item/<uuid> は漏らさない
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // iframe に入れさせない (CSP の frame-ancestors 'none' と二重)。
  // 「図を編集」の殻は srcdoc で応答を持たないので、このヘッダの対象にならない
  { key: 'X-Frame-Options', value: 'DENY' },
  // window.opener を使う連携は無い。別タブで開いた外部ページから戻って来られないようにする
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // 使う機能だけ自分に許す: スキャナ・画像検索 (camera)・録音 (microphone)。
  // 位置情報・決済・USB などは使わないので閉じる。パスキー
  // (publickey-credentials-get) とクリップボードは既定 (self) のまま触らない
  {
    key: 'Permissions-Policy',
    value:
      'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), display-capture=()',
  },
]
