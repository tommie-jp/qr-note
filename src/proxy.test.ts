import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { renewSession, findActiveSession } from '@/lib/sessionStore'
import { SESSION_RENEW_AFTER_MS, SESSION_TTL_MS } from '@/lib/sessionToken'
import { failEnvelope, jsonContract, responseContract } from '@/test/routeResponse'
import { proxy } from './proxy'

// セッションの DB だけを差し替える。照合の正本 (requestAuth.ts) と、公開パスの
// 一覧 (publicPaths.ts)・ループバックの判定は本物を通す
vi.mock('@/lib/sessionStore', () => ({
  findActiveSession: vi.fn(),
  renewSession: vi.fn(),
}))

const TOKEN = 'session-token'

interface RequestOptions {
  readonly method?: string
  readonly host?: string
  readonly cookie?: string
  // ローカル開発 (ループバック) は http で開かれる
  readonly protocol?: 'https' | 'http'
}

// 本番と同じホスト名で作る。ループバック IP だと loopbackRedirect が先に
// 割り込んで 307 になり、ここで見たい分岐まで届かない
function pageRequest(pathname: string, options: RequestOptions = {}): NextRequest {
  const host = options.host ?? 'qr.tommie.jp'
  const headers: Record<string, string> = { host }
  if (options.cookie !== undefined) {
    headers.cookie = options.cookie
  }
  return new NextRequest(
    new Request(`${options.protocol ?? 'https'}://${host}${pathname}`, {
      method: options.method ?? 'GET',
      headers,
    }),
  )
}

function loggedIn(pathname: string, options: RequestOptions = {}): NextRequest {
  return pageRequest(pathname, { ...options, cookie: `__Host-qr_session=${TOKEN}` })
}

// 応答のうち、門番が決めるものだけを並べる
function verdict(res: Response) {
  return {
    status: res.status,
    next: res.headers.get('x-middleware-next'),
    rewrite: res.headers.get('x-middleware-rewrite'),
    location: res.headers.get('location'),
    robots: res.headers.get('x-robots-tag'),
    setCookie: res.headers.get('set-cookie'),
  }
}

const PASS = { status: 200, next: '1', rewrite: null, location: null, robots: null, setCookie: null }
const PASS_NOINDEX = { ...PASS, robots: 'noindex' }

// 発行した直後 (延長はまだ要らない) と、延長の頃合いを過ぎた期限
function freshExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_MS)
}
function renewableExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_MS - SESSION_RENEW_AFTER_MS - 60_000)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(findActiveSession).mockResolvedValue(null)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

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

// ループバック IP で開かれたら localhost へ送り直す (loopbackRedirect.ts)。
// パスキーは 127.0.0.1 では使えないので、ログインの検査より先に割り込む
describe('ループバックの送り直し', () => {
  test.each([
    ['127.0.0.1:3000', '/settings?tab=a', 'http://localhost:3000/settings?tab=a'],
    ['[::1]:3000', '/login', 'http://localhost:3000/login'],
  ])('非本番で %s に来たら 307 で localhost へ', async (host, path, location) => {
    const res = await proxy(pageRequest(path, { host, protocol: 'http' }))

    expect(verdict(res)).toEqual({ ...PASS, status: 307, next: null, location })
  })

  // 307 はメソッドを保つ。Server Action の POST もそのまま送り直される
  test('POST もログイン検査より先に送り直す', async () => {
    const res = await proxy(
      pageRequest('/item/1', { host: '127.0.0.1:3000', protocol: 'http', method: 'POST' }),
    )

    expect(res.status).toBe(307)
    expect(findActiveSession).not.toHaveBeenCalled()
  })

  test('本番では送り直さず、いつもの門番を通る', async () => {
    vi.stubEnv('APP_ENV', 'production')

    const res = await proxy(pageRequest('/login', { host: '127.0.0.1:3000', protocol: 'http' }))

    expect(verdict(res)).toEqual(PASS)
  })
})

describe('素通し (セッションを引かない)', () => {
  test.each([
    ['GET', '/login'],
    ['POST', '/login'],
    ['GET', '/docs/search'],
    ['GET', '/manifest.webmanifest'],
  ])('公開パスは %s %s でも通す', async (method, path) => {
    const res = await proxy(pageRequest(path, { method, cookie: `__Host-qr_session=${TOKEN}` }))

    expect(verdict(res)).toEqual(PASS)
    expect(findActiveSession).not.toHaveBeenCalled()
  })

  test.each(['/login-required', '/offline'])('中身の無い公開パス %s は noindex で通す', async (path) => {
    const res = await proxy(pageRequest(path))

    expect(verdict(res)).toEqual(PASS_NOINDEX)
  })

  // 公開かどうかがデータで決まる口。読み取りだけ通し、判定はページに委ねる
  test.each([
    ['GET', '/item/4518'],
    ['HEAD', '/print/4518'],
    ['GET', '/api/images/0f8fad5b-d9cb-469f-a165-70867728950e.png'],
  ])('自前で判定する口の %s %s は未ログインでも通す', async (method, path) => {
    const res = await proxy(pageRequest(path, { method }))

    expect(verdict(res)).toEqual(PASS)
    expect(findActiveSession).not.toHaveBeenCalled()
  })

  // 書き込み (Server Action の POST) は門番で止める。公開ノートは読み取り専用
  test('自前で判定する口でも未ログインの POST は 401', async () => {
    const res = await proxy(pageRequest('/item/4518', { method: 'POST' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(401, failEnvelope('ログインが必要です')),
    )
  })

  // 前方一致で通すと別のページまで素通しする
  test('自前で判定する口の奥のパスは素通ししない', async () => {
    const res = await proxy(pageRequest('/item/4518/edit'))

    expect(res.headers.get('x-middleware-rewrite')).toBe('https://qr.tommie.jp/login-required')
  })
})

describe('ログイン済み', () => {
  test('有効なセッションなら通し、延長の頃合いでなければ Cookie に触らない', async () => {
    vi.mocked(findActiveSession).mockResolvedValue({ userName: 'tommie', expiresAt: freshExpiry() })

    const res = await proxy(loggedIn('/settings'))

    expect(verdict(res)).toEqual(PASS)
    expect(findActiveSession).toHaveBeenCalledWith(TOKEN)
    expect(renewSession).not.toHaveBeenCalled()
  })

  test('API の POST も通す', async () => {
    vi.mocked(findActiveSession).mockResolvedValue({ userName: 'tommie', expiresAt: freshExpiry() })

    const res = await proxy(loggedIn('/api/items', { method: 'POST' }))

    expect(verdict(res)).toEqual(PASS)
  })

  test('延長の頃合いなら DB を延ばし、Cookie の Max-Age も貼り直す', async () => {
    vi.mocked(findActiveSession).mockResolvedValue({ userName: 'tommie', expiresAt: renewableExpiry() })

    const res = await proxy(loggedIn('/trash'))

    const { setCookie, ...rest } = verdict(res)
    expect(renewSession).toHaveBeenCalledWith(TOKEN)
    expect(rest).toEqual({ ...PASS, setCookie: undefined })
    // Expires は Max-Age から Next が足す (時刻に依るので形だけ見る)
    expect(setCookie).toMatch(
      new RegExp(
        `^__Host-qr_session=${TOKEN}; Path=/; Expires=[^;]+; Max-Age=7776000; Secure; HttpOnly; SameSite=lax$`,
      ),
    )
  })

  // 延長は「90 日が 90 日に戻らなかった」だけ。締め出す理由にしない
  test('延長に失敗しても Cookie を貼らずに通す', async () => {
    vi.mocked(findActiveSession).mockResolvedValue({ userName: 'tommie', expiresAt: renewableExpiry() })
    vi.mocked(renewSession).mockRejectedValue(new Error('DB が落ちた'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await proxy(loggedIn('/trash'))

    expect(verdict(res)).toEqual(PASS)
    expect(error).toHaveBeenCalledWith('セッションの期限延長に失敗しました', expect.any(Error))
  })
})

describe('未ログイン', () => {
  // URL をそのままに案内へ差し替える。ログインすれば再読み込みだけで戻れる
  test.each([
    ['GET', '/settings', 'noindex'],
    ['HEAD', '/trash', 'noindex'],
    ['GET', '/', null],
  ])('画面の %s %s は案内へ rewrite する (noindex=%s)', async (method, path, robots) => {
    const res = await proxy(pageRequest(path, { method }))

    expect(verdict(res)).toEqual({
      ...PASS,
      next: null,
      rewrite: 'https://qr.tommie.jp/login-required',
      robots,
    })
  })

  test('照合できないセッション Cookie も未ログインとして扱う', async () => {
    const res = await proxy(loggedIn('/settings'))

    expect(findActiveSession).toHaveBeenCalledWith(TOKEN)
    expect(res.headers.get('x-middleware-rewrite')).toBe('https://qr.tommie.jp/login-required')
  })

  // API と書き込み (Server Action の POST を含む) は機械が読む口。案内の HTML は返さない
  test.each([
    ['GET', '/api/items'],
    ['HEAD', '/api/tags'],
    ['POST', '/api/items'],
    ['POST', '/settings'],
    ['DELETE', '/api/auth/passkeys/1'],
  ])('%s %s は 401 の JSON (apiFail と同じ封筒)', async (method, path) => {
    const res = await proxy(pageRequest(path, { method }))

    expect(await responseContract(res)).toEqual(
      jsonContract(401, failEnvelope('ログインが必要です')),
    )
    expect(res.headers.get('x-robots-tag')).toBeNull()
  })
})
