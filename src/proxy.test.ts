import { beforeAll, describe, expect, test } from 'vitest'
import { NextRequest } from 'next/server'
import type { proxy as ProxyFn } from './proxy'

// proxy.ts は @/lib/db を import し、db.ts は読み込み時に DATABASE_URL を要求する。
// 未設定のときだけ到達不能なダミーを置く (images.test.ts と同じ約束)。
// ここのテストは未ログイン = Cookie 無しなので、resolveSession は DB を引かずに
// null を返す。誤って引けば接続エラーで落ちる
process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused'

// ダミーを置くより先に import が走ってしまうため、proxy 本体は動的に読む
// (images.test.ts と同じ手)
let proxy: typeof ProxyFn

beforeAll(async () => {
  ;({ proxy } = await import('./proxy'))
})

// 本番と同じホスト名で作る。ループバック IP だと loopbackRedirect が先に
// 割り込んで 307 になり、ここで見たい分岐まで届かない
function pageRequest(pathname: string): NextRequest {
  return new NextRequest(
    new Request(`https://qr.tommie.jp${pathname}`, { headers: { host: 'qr.tommie.jp' } }),
  )
}

// ログイン案内をインデックスさせない (docs/90-クローラ対策計画.md §2)。
//
// proxy は未ログインの画面 GET を /login-required へ **rewrite** する。
// redirect ではないので応答は「元の URL のまま 200」— 放っておくと
// /settings, /trash, /edit/… が中身の同じページとして URL の数だけ並ぶ。
describe('未ログインの案内は noindex', () => {
  test.each(['/settings', '/trash', '/new'])('%s は noindex を付ける', async (pathname) => {
    const res = await proxy(pageRequest(pathname))
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
  })

  // **サイトの根だけは付けない。** SNS のカード生成クローラーが読むのはそこで
  // (docs/89-OGP計画.md §6 は `curl -sA Twitterbot https://…/` で確かめている)、
  // noindex を見たクローラーはカードを出さないことがある。
  // X は「カードなし」も 1 週間キャッシュするので、壊すと戻すのに時間がかかる
  test('サイトの根には付けない (SNS カードを壊さない)', async () => {
    const res = await proxy(pageRequest('/'))
    expect(res.headers.get('x-robots-tag')).toBeNull()
  })

  // 案内ページを直接開かれたときも同じ扱いにする (rewrite 経由と揃える)
  test('/login-required を直接開いても noindex', async () => {
    const res = await proxy(pageRequest('/login-required'))
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
  })

  // オフラインの画面も同じ。ノートを 1 件も含まない殻で、中身は端末の
  // IndexedDB からしか来ない (publicPaths.ts) — 載っても空の紙が並ぶだけ
  test('/offline (中身の無い殻) も noindex', async () => {
    const res = await proxy(pageRequest('/offline'))
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
  })

  // 使い方の説明は載せてよい。公開している以上、読まれて困るものではない
  test('公開の使い方ページには付けない', async () => {
    const res = await proxy(pageRequest('/docs/search'))
    expect(res.headers.get('x-robots-tag')).toBeNull()
  })
})
