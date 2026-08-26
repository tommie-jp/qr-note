import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { POST as PostFn } from './route'
import type { GET as GetFn } from './[name]/route'
import type { PrismaClient } from '@/generated/prisma/client'
import { MAX_VIDEO_ANIM_FRAMES } from '@/lib/uploads'

// route を関数として直接呼ぶため、Next.js のリクエストスコープが無く headers() が
// 投げる。ログイン検査 (lib/session.ts) が headers() を読むので、そこだけ差し替える。
// 検査そのもの (bcrypt 照合) は本物を通す — モックすると、認証が壊れていても
// 拒否系のテストが緑のままになる
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  // デモの総量クォータ (docs/39 §2-1) のテスト用。SUM(octet_length) の値を
  // 差し替える。既定 0 なので、デモでない通常のテストは一切影響を受けない
  totalAttachmentBytes: 0,
}))

// route を関数として直接呼ぶため、Next.js のリクエストスコープが無く
// cookies() が投げる。そこだけ差し替える。
//
// 認証はセッション Cookie で行う (docs/18-ログイン計画.md §11)。
// 判定そのもの (requestAuth.ts) は本物を通し、DB を叩く findActiveSession
// だけを差し替える — 判定ごとモックすると、認証が壊れていても拒否系の
// テストが緑のままになる
vi.mock('next/headers', async () => {
  const { SESSION_COOKIE_NAME } = await import('@/lib/sessionToken')
  return {
    headers: async () => new Headers(),
    cookies: async () => ({
      get: (name: string) =>
        name === SESSION_COOKIE_NAME && mocks.sessionToken !== null
          ? { name, value: mocks.sessionToken }
          : undefined,
    }),
  }
})

vi.mock('@/lib/sessionStore', () => ({
  findActiveSession: async (token: string) =>
    token === mocks.validToken
      ? { userName: 'tommie', expiresAt: new Date('2099-01-01T00:00:00.000Z') }
      : null,
}))

// 総量クォータの合計だけ差し替える (SUM は DB を引くため)。他の関数
// (saveImage など) は本物のまま — importOriginal で残す。デモの 507 は
// storeAttachment より手前で返るので、実 DB なしで検証できる
vi.mock('@/lib/imageStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/imageStore')>()
  return { ...actual, totalAttachmentBytes: async () => mocks.totalAttachmentBytes }
})


// 既定はログイン済み。拒否系が見たいのは「ログインの先にある検査」なので、
// ログインで落ちてしまうと何も検査できない
beforeEach(() => {
  mocks.sessionToken = mocks.validToken
  mocks.totalAttachmentBytes = 0
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// 画像は DB (images テーブル) に格納するため、往復の検証には実 DB が要る。
// DATABASE_URL があり かつ RUN_DB_TESTS=1 のときだけ実行する。
const runDbTests =
  !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === '1'

// 一方、拒否系 (CSRF・MIME・サイズ・不正ファイル名) はすべて DB へ到達する前に
// return するため、実 DB なしで検証できる。ルート配線が壊れていないことを
// 通常の `npm test` (doDeploy の lint+test) でも検知したいので DB ゲートに入れない。
//
// ただし route は @/lib/db を import し、db.ts は読み込み時に DATABASE_URL を要求する。
// そこで未設定のときだけ到達不能なダミーを置く。PrismaClient は遅延接続のため
// クエリを投げない限り接続しない = 拒否系が誤って DB に触れたら接続エラーで落ちる。
// (「DB に触れる前に弾く」契約そのもののテストにもなっている)
process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused'

// 公開判定のテストが作るノートの itemNo プレフィックス。実データと衝突させない
// (items.test.ts と同じ約束)
const TEST_PREFIX = 'zzft'

// 1x1 の PNG (最小の有効な画像バイナリ)
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

function uploadRequest(file: File, headers?: Record<string, string>): Request {
  const formData = new FormData()
  formData.set('file', file)
  return new Request('http://localhost/api/images', {
    method: 'POST',
    body: formData,
    headers,
  })
}

function getRequest(name: string): [Request, { params: Promise<{ name: string }> }] {
  return [
    new Request(`http://localhost/api/images/${name}`),
    { params: Promise.resolve({ name }) },
  ]
}

// 一覧用の縮小版を求める GET (docs/23-検索結果表示モード計画.md §2)
function thumbRequest(name: string): [Request, { params: Promise<{ name: string }> }] {
  return [
    new Request(`http://localhost/api/images/${name}?thumb=1`),
    { params: Promise.resolve({ name }) },
  ]
}

function pngFile(): File {
  return new File([PNG_BYTES], 'photo.png', { type: 'image/png' })
}

// 最小の WAV (RIFF....WAVE + 詰め物)。sniffAudioFormat は先頭の "RIFF"/"WAVE"
// だけを見るので、再生可能である必要はない。Range で切り出せるよう 64B にする
const WAV_BYTES = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x38, 0x00, 0x00, 0x00]),
  Buffer.from('WAVE'),
  Buffer.alloc(52, 0x41),
])

function wavFile(): File {
  return new File([WAV_BYTES], 'memo.wav', { type: 'audio/wav' })
}

// iOS Safari の録音・iPhone のボイスメモと同じ並び (ftyp → mdat → moov)。
// moov が末尾にあると <audio preload="metadata"> が再生を始められないため、
// 保存時に先頭へ移す (docs/12「iPhone で録音が再生できなかった件」)
function m4aBox(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(8 + payload.length, 0)
  header.write(type, 4, 'latin1')
  return Buffer.concat([header, payload])
}

const MOOV_LAST_M4A = (() => {
  const ftyp = m4aBox('ftyp', Buffer.from('M4A isommp42', 'latin1'))
  const mdat = m4aBox('mdat', Buffer.alloc(48, 0x41))
  const stcoPayload = Buffer.alloc(12)
  stcoPayload.writeUInt32BE(1, 4) // エントリ数
  stcoPayload.writeUInt32BE(ftyp.length + 8, 8) // mdat の中身の先頭を指す
  const moov = m4aBox(
    'moov',
    m4aBox('trak', m4aBox('mdia', m4aBox('minf', m4aBox('stbl', m4aBox('stco', stcoPayload))))),
  )
  return { bytes: Buffer.concat([ftyp, mdat, moov]), ftypLength: ftyp.length }
})()

function boxTypeAt(bytes: Buffer, at: number): string {
  return bytes.subarray(at + 4, at + 8).toString('latin1')
}

// 映像トラック (hdlr = 'vide') を持つ最小の mp4。sniffVideoFormat は
// ブランドではなくトラック種別で動画と判定するので、moov/trak/mdia/hdlr まで
// 組む必要がある (uploads.test.ts の mp4WithHandlers と同じ形)
const MP4_BYTES = (() => {
  const hdlr = m4aBox('hdlr', (() => {
    const payload = Buffer.alloc(25)
    payload.write('vide', 8, 'latin1')
    return payload
  })())
  const moov = m4aBox('moov', m4aBox('trak', m4aBox('mdia', hdlr)))
  const ftyp = m4aBox('ftyp', Buffer.from('isomisommp42', 'latin1'))
  return Buffer.concat([ftyp, moov])
})()

function mp4File(): File {
  return new File([MP4_BYTES], 'movie.mp4', { type: 'video/mp4' })
}

// 動くサムネのコマ (docs/72-動画アニメサムネ計画.md)。クライアントが canvas から
// 出すのと同じ JPEG を sharp で作る。色を変えるのは、全コマ同一だと束ねた結果が
// 1 ページに畳まれかねないため
async function animFrames(count: number): Promise<Blob[]> {
  const sharp = (await import('sharp')).default
  return Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const buffer = await sharp({
        create: {
          width: 160,
          height: 90,
          channels: 3,
          background: { r: 20 + i * 25, g: 90, b: 200 - i * 20 },
        },
      })
        .jpeg()
        .toBuffer()
      return new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' })
    }),
  )
}

// 動画 + poster + 動くサムネのコマ を 1 回の POST で送る (本番の送信と同じ形)
function videoUploadRequest(poster: Blob | null, frames: Blob[]): Request {
  const formData = new FormData()
  formData.set('file', mp4File())
  if (poster) {
    formData.set('thumb', poster, 'poster.jpg')
  }
  for (const [index, frame] of frames.entries()) {
    formData.append('thumbFrames', frame, `frame${index}.jpg`)
  }
  return new Request('http://localhost/api/images', {
    method: 'POST',
    body: formData,
  })
}

// 動くサムネを求める GET (docs/72-動画アニメサムネ計画.md)
function animRequest(name: string): [Request, { params: Promise<{ name: string }> }] {
  return [
    new Request(`http://localhost/api/images/${name}?thumb=1&anim=1`),
    { params: Promise.resolve({ name }) },
  ]
}

// 最小の PDF (先頭の "%PDF-" だけを見るので、開ける必要はない)
const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n')

function pdfFile(): File {
  return new File([PDF_BYTES], '仕様書.pdf', { type: 'application/pdf' })
}

function rangeRequest(
  name: string,
  range: string,
): [Request, { params: Promise<{ name: string }> }] {
  return [
    new Request(`http://localhost/api/images/${name}`, { headers: { range } }),
    { params: Promise.resolve({ name }) },
  ]
}

// HEIC フィクスチャ (src/lib/__fixtures__)。iOS が MIME を空で送る経路も
// 兼ねて確かめるため type は空にする — 形式判定は中身の先頭バイトで行う
const HEIC_FIXTURE = join(__dirname, '..', '..', '..', 'lib', '__fixtures__', 'sample.heic')
function heicFile(): File {
  return new File([readFileSync(HEIC_FIXTURE)], 'photo.heic', { type: '' })
}

// db.ts は import 時に DATABASE_URL を読むため、routes の import は
// 上のダミー設定より後 (= beforeAll 内) で動的に行う。
describe('/api/images の拒否系 (実 DB 不要)', () => {
  let POST: typeof PostFn
  let GET: typeof GetFn

  beforeAll(async () => {
    ;({ POST } = await import('./route'))
    ;({ GET } = await import('./[name]/route'))
  })

  test('画像以外の MIME は 400 を返す', async () => {
    const file = new File(['<svg onload=alert(1)>'], 'x.svg', {
      type: 'image/svg+xml',
    })
    const res = await POST(uploadRequest(file))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBeTruthy()
  })

  test('file フィールドがないと 400 を返す', async () => {
    const res = await POST(
      new Request('http://localhost/api/images', {
        method: 'POST',
        body: new FormData(),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('サイズ超過は 400 を返す', async () => {
    const big = new File([Buffer.alloc(10 * 1024 * 1024 + 1)], 'big.png', {
      type: 'image/png',
    })
    const res = await POST(uploadRequest(big))
    expect(res.status).toBe(400)
  })

  test('MIME 偽装 (image/png を名乗る HTML) は 400 を返す', async () => {
    const fake = new File(['<html><script>alert(1)</script></html>'], 'x.png', {
      type: 'image/png',
    })
    const res = await POST(uploadRequest(fake))
    expect(res.status).toBe(400)
  })

  // 音声を名乗るが中身が音声でないもの (詐称) は保存前に弾く。
  // 画像でも音声でもないので、中身判定 (sniff) が両方外れて 400 になる
  test('音声を名乗る HTML (中身が音声でない) は 400 を返す', async () => {
    const fake = new File(['<html>not audio</html>'], 'x.mp3', {
      type: 'audio/mpeg',
    })
    const res = await POST(uploadRequest(fake))
    expect(res.status).toBe(400)
  })

  test('PDF を名乗る HTML (中身が PDF でない) は 400 を返す', async () => {
    const fake = new File(['<html><script>alert(1)</script></html>'], 'x.pdf', {
      type: 'application/pdf',
    })
    const res = await POST(uploadRequest(fake))
    expect(res.status).toBe(400)
  })

  // テキスト系 (docs/12-添付ファイル種類拡張メモ.md)。受け入れ条件は
  // 「名前が txt/csv/md」かつ「中身がテキストとして読める」の両方。
  // ここでは片方ずつ欠けたものが弾かれることを確かめる (どちらも DB に届かない)
  test('.txt と名乗るバイナリは 400 を返す', async () => {
    // ELF ヘッダ。テキストとしては制御文字だらけで読めない
    const elf = new File(
      [Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00])],
      'memo.txt',
      { type: 'text/plain' },
    )
    expect((await POST(uploadRequest(elf))).status).toBe(400)
  })

  test('テキストでも名前が txt/csv/md でなければ 400 を返す', async () => {
    // 中身は読めるテキストだが、名前が別形式を名乗っている。
    // 上の「x.png を名乗る HTML」と同じ扱いにする (偽装は受けない)
    const fake = new File(['id,name\n1,x\n'], 'x.html', { type: 'text/html' })
    expect((await POST(uploadRequest(fake))).status).toBe(400)
  })

  test('クロスオリジンの POST (CSRF) は 403 を返す', async () => {
    const res = await POST(
      uploadRequest(pngFile(), { origin: 'https://evil.example.com' }),
    )
    expect(res.status).toBe(403)
  })

  test('Content-Length が大きすぎる場合は本文を読まず 413 を返す', async () => {
    const res = await POST(
      new Request('http://localhost/api/images', {
        method: 'POST',
        headers: { 'content-length': String(100 * 1024 * 1024) },
        body: new FormData(),
      }),
    )
    expect(res.status).toBe(413)
  })

  test('GET: 不正なファイル名 (トラバーサル) は 400 を返す', async () => {
    const [req, ctx] = getRequest('..%2F..%2Fetc%2Fpasswd')
    const res = await GET(req, ctx)
    expect(res.status).toBe(400)
  })

  // デモの総量クォータ (docs/39-デモ公開計画.md §2-1)。DEMO_MODE のときだけ、
  // 保存前に合計を見て上限超過なら 507。storeAttachment (DB) より手前で返るので
  // 実 DB なしで検証できる。デモでないときの素通しは合計を見た後に DB へ進むため、
  // この describe (実 DB 不要) では確かめられない — 境界は demoLimits.test.ts が持つ
  describe('デモの総量クォータ', () => {
    test('総量が上限ちょうどで、さらに 1 枚上げようとすると 507 を返す', async () => {
      vi.stubEnv('DEMO_MODE', '1')
      mocks.totalAttachmentBytes = 200 * 1024 * 1024 // 上限ちょうど。残り 0
      const res = await POST(uploadRequest(pngFile()))
      expect(res.status).toBe(507)
    })

    test('デモでなければ総量が大きくても 507 では断らない (401/400 でもない)', async () => {
      // DEMO_MODE 未設定。クォータの分岐を通らないことだけ確かめたいが、
      // 素通しは DB へ進むため、ここでは「クォータ由来の 507 にならない」に留める。
      // 未ログインでないと 401 になるので、ログイン済みのまま送る
      mocks.totalAttachmentBytes = 999 * 1024 * 1024
      // 中身が壊れた小さい画像を送り、DB へ届く前 (400) で止める。
      // クォータが誤って効いていれば 507 になるはずで、それが起きないことを見る
      const tiny = new File(['not-an-image'], 'x.png', { type: 'image/png' })
      const res = await POST(uploadRequest(tiny))
      expect(res.status).toBe(400)
    })
  })

  // ログイン検査 (docs/18-ログイン計画.md)。proxy.ts も未ログインを 401 にするが、
  // それは楽観的な検査でしかないので、route 自身が断れることをここで確かめる
  describe('未ログイン', () => {
    beforeEach(() => {
      mocks.sessionToken = null
    })

    test('POST は 401 を返す', async () => {
      const res = await POST(uploadRequest(pngFile()))
      expect(res.status).toBe(401)
    })

    // GET の未ログインは DB ゲート側にある。公開ノートに貼った画像は未ログイン
    // でも配るようになり (docs/22-ノート公開計画.md §6)、配ってよいかは
    // items を引かないと判らないため、ここ (実 DB なし) では検証できない。
    // 公開/非公開/ゴミ箱の 3 通りは下の統合テストで見る

    test('GET: 不正なファイル名はログイン検査より先に 400 (DB を引かせない)', async () => {
      // 名前を position() へ渡す前に書式を確かめる、という順序の担保。
      // この DB は到達不能なので、順序が壊れれば接続エラーで落ちる
      mocks.sessionToken = null
      const [req, ctx] = getRequest('..%2F..%2Fetc%2Fpasswd')
      const res = await GET(req, ctx)
      expect(res.status).toBe(400)
    })

    test('POST はファイル名の検査より先に断る (本文を読ませない)', async () => {
      // 中身が不正でも 400 ではなく 401。ログインしていない相手のために
      // 12MB のボディを読む理由はない
      const bad = new File(['<svg onload=alert(1)>'], 'x.svg', { type: 'image/svg+xml' })
      const res = await POST(uploadRequest(bad))
      expect(res.status).toBe(401)
    })
  })
})

describe.skipIf(!runDbTests)(
  '/api/images の DB 往復 (integration; needs DATABASE_URL + RUN_DB_TESTS=1)',
  () => {
    let POST: typeof PostFn
    let GET: typeof GetFn
    let prisma: PrismaClient

    // テストで作った画像は UUID 名のため前方一致で消せない。作った名前を控えて後始末する。
    const created: string[] = []
    // 公開判定のテストで作るノート。実データと衝突しないよう items.test.ts と
    // 同じ "zzft" プレフィックスで統一し、後始末で消す
    const noteItemNos: string[] = []

    beforeAll(async () => {
      ;({ POST } = await import('./route'))
      ;({ GET } = await import('./[name]/route'))
      ;({ prisma } = await import('@/lib/db'))
    })

    afterAll(async () => {
      if (!prisma) return
      await prisma.image.deleteMany({ where: { name: { in: created } } })
      await prisma.item.deleteMany({ where: { itemNo: { in: noteItemNos } } })
      await prisma.$disconnect()
    })

    // アップロードして保存名を返す (後始末のため名前を控える)
    async function upload(file: File, headers?: Record<string, string>): Promise<string> {
      const res = await POST(uploadRequest(file, headers))
      expect(res.status).toBe(200)
      const body = await res.json()
      const name = body.data.url.split('/').pop() as string
      created.push(name)
      return name
    }

    test('PNG をアップロードすると URL を返し、GET で同じバイト列が取得できる', async () => {
      const res = await POST(uploadRequest(pngFile()))
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.url).toMatch(/^\/api\/images\/[0-9a-f-]{36}\.png$/)

      const name = body.data.url.split('/').pop() as string
      created.push(name)

      const [req, ctx] = getRequest(name)
      const getRes = await GET(req, ctx)
      expect(getRes.status).toBe(200)
      expect(getRes.headers.get('content-type')).toBe('image/png')
      // 公開ノートに貼った画像は未ログインでも配る (docs/22 §6) ため、
      // クローラーの手も届く。HTML の noindex は画像そのものには効かないので、
      // 配信そのものに付ける (docs/90-クローラ対策計画.md §2)
      expect(getRes.headers.get('x-robots-tag')).toBe('noindex')
      const bytes = Buffer.from(await getRes.arrayBuffer())
      expect(bytes.equals(PNG_BYTES)).toBe(true)
    })

    // 音声 (docs/12-添付ファイル種類拡張メモ.md)。画像と違い変換・サムネ・
    // 埋め込みを作らず、そのまま images テーブルへ保存してそのまま配信する
    test('WAV をアップロードすると .wav 名で保存し、GET で同じバイト列を配る', async () => {
      const res = await POST(uploadRequest(wavFile()))
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.url).toMatch(/^\/api\/images\/[0-9a-f-]{36}\.wav$/)

      const name = body.data.url.split('/').pop() as string
      created.push(name)

      const [req, ctx] = getRequest(name)
      const getRes = await GET(req, ctx)
      expect(getRes.status).toBe(200)
      expect(getRes.headers.get('content-type')).toBe('audio/wav')
      // <audio> のシークに応えるため Range 可を知らせる
      expect(getRes.headers.get('accept-ranges')).toBe('bytes')
      const bytes = Buffer.from(await getRes.arrayBuffer())
      expect(bytes.equals(WAV_BYTES)).toBe(true)
    })

    // テキスト系 (docs/12-添付ファイル種類拡張メモ.md)。音声・PDF と同じく
    // 素通しだが、**保存前に UTF-8 へ正規化する**ぶんだけ違う
    test('CSV をアップロードすると .csv 名で保存し、charset つきで配る', async () => {
      const csv = new File(['id,name\n1,ねじ\n'], '部品表.csv', {
        type: 'text/csv',
      })
      const res = await POST(uploadRequest(csv))
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.data.url).toMatch(/^\/api\/images\/[0-9a-f-]{36}\.csv$/)

      const name = body.data.url.split('/').pop() as string
      created.push(name)

      const [req, ctx] = getRequest(name)
      const getRes = await GET(req, ctx)
      expect(getRes.status).toBe(200)
      expect(getRes.headers.get('content-type')).toBe('text/csv; charset=utf-8')
      // ユーザー由来のバイト列なので、ブラウザに種別を推測させない
      expect(getRes.headers.get('x-content-type-options')).toBe('nosniff')
      expect(await getRes.text()).toBe('id,name\n1,ねじ\n')
    })

    test('Shift_JIS のテキストは UTF-8 に直して保存する', async () => {
      // "日本語" (CP932)
      const sjis = Uint8Array.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x0a])
      const name = await upload(new File([sjis], 'メモ.txt', { type: '' }))

      const [req, ctx] = getRequest(name)
      const getRes = await GET(req, ctx)
      expect(getRes.headers.get('content-type')).toBe('text/plain; charset=utf-8')
      expect(await getRes.text()).toBe('日本語\n')
    })

    test('UTF-16 (BOM 付き) の CSV も UTF-8 に直して保存する', async () => {
      // Excel や iOS 上のアプリが出す UTF-16 CSV。BOM + "id,名前\n" を UTF-16LE で
      const units = [0xfeff, ...'id,名前\n'].map((c) =>
        typeof c === 'number' ? c : c.codePointAt(0)!,
      )
      const le = new Uint8Array(units.length * 2)
      units.forEach((u, i) => {
        le[i * 2] = u & 0xff
        le[i * 2 + 1] = (u >> 8) & 0xff
      })
      const name = await upload(new File([le], '部品表.csv', { type: 'text/csv' }))

      const [req, ctx] = getRequest(name)
      const getRes = await GET(req, ctx)
      expect(getRes.headers.get('content-type')).toBe('text/csv; charset=utf-8')
      // 配信は UTF-8。BOM も落ちている
      expect(await getRes.text()).toBe('id,名前\n')
    })

    test('テキストはサムネも埋め込みも作らない (一覧・画像検索に混ざらない)', async () => {
      const name = await upload(new File(['# 設計メモ\n'], 'design.md'))
      const row = await prisma.image.findUnique({ where: { name } })
      expect(row?.mime).toBe('text/markdown; charset=utf-8')
      expect(row?.thumb).toBeNull()
      expect(row?.embedding).toBeNull()
    })

    test('音声はサムネも埋め込みも作らず、そのまま保存される', async () => {
      const name = await upload(wavFile())
      const row = await prisma.image.findUnique({ where: { name } })
      expect(row?.mime).toBe('audio/wav')
      expect(row?.thumb).toBeNull()
      expect(row?.embedding).toBeNull()
      expect(Buffer.from(row?.data as Uint8Array).equals(WAV_BYTES)).toBe(true)
    })

    test('末尾に moov のある m4a は保存時に moov を先頭へ移す', async () => {
      const { bytes, ftypLength } = MOOV_LAST_M4A
      // 保存前は ftyp → mdat → moov
      expect(boxTypeAt(bytes, 0)).toBe('ftyp')
      expect(boxTypeAt(bytes, ftypLength)).toBe('mdat')

      const name = await upload(new File([bytes], 'rec.m4a', { type: 'audio/mp4' }))
      const row = await prisma.image.findUnique({ where: { name } })
      const stored = Buffer.from(row?.data as Uint8Array)

      expect(row?.mime).toBe('audio/mp4')
      // 保存後は ftyp → moov → mdat (先頭を読むだけで再生を始められる)
      expect(boxTypeAt(stored, 0)).toBe('ftyp')
      expect(boxTypeAt(stored, ftypLength)).toBe('moov')
      // 詰め替えただけなので長さは変わらない
      expect(stored.length).toBe(bytes.length)
    })

    test('既に moov が先頭にある m4a はそのまま保存する', async () => {
      const { bytes } = MOOV_LAST_M4A
      // 一度保存したものを取り出して、もう一度上げても中身が変わらないこと
      const first = await upload(new File([bytes], 'rec.m4a', { type: 'audio/mp4' }))
      const stored = Buffer.from(
        (await prisma.image.findUnique({ where: { name: first } }))?.data as Uint8Array,
      )
      const second = await upload(new File([stored], 'rec.m4a', { type: 'audio/mp4' }))
      const again = Buffer.from(
        (await prisma.image.findUnique({ where: { name: second } }))?.data as Uint8Array,
      )
      expect(again.equals(stored)).toBe(true)
    })

    test('Range 要求には 206 で部分を返す (音声のシーク)', async () => {
      const name = await upload(wavFile())

      const [req, ctx] = rangeRequest(name, 'bytes=0-9')
      const res = await GET(req, ctx)

      expect(res.status).toBe(206)
      expect(res.headers.get('content-range')).toBe(`bytes 0-9/${WAV_BYTES.length}`)
      expect(res.headers.get('content-type')).toBe('audio/wav')
      // 部分応答も基本ヘッダを継ぐこと (取りこぼすと Range を投げる相手だけ素通し)
      expect(res.headers.get('x-robots-tag')).toBe('noindex')
      const bytes = Buffer.from(await res.arrayBuffer())
      expect(bytes.equals(WAV_BYTES.subarray(0, 10))).toBe(true)
    })

    // PDF (docs/12-添付ファイル種類拡張メモ.md)。音声と同じ「変換しない添付」
    // の経路に乗り、表示はブラウザ内蔵ビューアに任せる
    test('PDF をアップロードすると .pdf 名で保存し、GET で同じバイト列を配る', async () => {
      const res = await POST(uploadRequest(pdfFile()))
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.url).toMatch(/^\/api\/images\/[0-9a-f-]{36}\.pdf$/)

      const name = body.data.url.split('/').pop() as string
      created.push(name)

      const [req, ctx] = getRequest(name)
      const getRes = await GET(req, ctx)
      expect(getRes.status).toBe(200)
      expect(getRes.headers.get('content-type')).toBe('application/pdf')
      // ユーザー由来のバイト列なので MIME スニッフィングは禁止のまま
      expect(getRes.headers.get('x-content-type-options')).toBe('nosniff')
      const bytes = Buffer.from(await getRes.arrayBuffer())
      expect(bytes.equals(PDF_BYTES)).toBe(true)
    })

    test('PDF はサムネも埋め込みも作らず、そのまま保存される', async () => {
      const name = await upload(pdfFile())
      const row = await prisma.image.findUnique({ where: { name } })
      expect(row?.mime).toBe('application/pdf')
      expect(row?.thumb).toBeNull()
      expect(row?.embedding).toBeNull()
      expect(Buffer.from(row?.data as Uint8Array).equals(PDF_BYTES)).toBe(true)
    })

    test('範囲外の Range は 416 を返す', async () => {
      const name = await upload(wavFile())

      const [req, ctx] = rangeRequest(name, `bytes=${WAV_BYTES.length + 10}-`)
      const res = await GET(req, ctx)

      expect(res.status).toBe(416)
      expect(res.headers.get('content-range')).toBe(`bytes */${WAV_BYTES.length}`)
    })

    // HEIC (iPhone 標準) は保存時に WebP へ変換する (docs/26-画像形式対応計画.md)。
    // MIME を空で送っても中身で判定して受け付け、保存名・配信ともに webp になる
    test.skipIf(!existsSync(HEIC_FIXTURE))(
      'HEIC をアップロードすると WebP に変換して保存する',
      async () => {
        const res = await POST(uploadRequest(heicFile()))
        expect(res.status).toBe(200)

        const body = await res.json()
        expect(body.success).toBe(true)
        // 変換後の拡張子は webp (heic のままではない)
        expect(body.data.url).toMatch(/^\/api\/images\/[0-9a-f-]{36}\.webp$/)

        const name = body.data.url.split('/').pop() as string
        created.push(name)

        const [req, ctx] = getRequest(name)
        const getRes = await GET(req, ctx)
        expect(getRes.status).toBe(200)
        expect(getRes.headers.get('content-type')).toBe('image/webp')
      },
    )

    // 一覧用サムネ (docs/23-検索結果表示モード計画.md §2)。
    // 原寸のまま 20 枚並べると一覧が使い物にならないので、?thumb=1 の口と
    // 「未生成なら原寸で代替」の分岐がここの要になる

    test('アップロード時にサムネを作り、?thumb=1 で縮小版を配る', async () => {
      const name = await upload(pngFile())

      const [req, ctx] = thumbRequest(name)
      const res = await GET(req, ctx)

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/webp')
      // 原寸 (image/png) ではないこと = 縮小版が返っている
      expect(res.headers.get('cache-control')).toContain('immutable')
      // サムネは原寸と別の経路 (imageResponse) を通る。片方だけ付けても
      // 画像検索に載るのはサムネのほうなので、両方で確かめる
      expect(res.headers.get('x-robots-tag')).toBe('noindex')
    })

    test('?thumb=1 が無ければ今までどおり原寸を配る', async () => {
      const name = await upload(pngFile())

      const [req, ctx] = getRequest(name)
      const res = await GET(req, ctx)

      expect(res.headers.get('content-type')).toBe('image/png')
    })

    test('サムネ未生成の画像は ?thumb=1 でも原寸で代替する (絵が割れない)', async () => {
      // バックフィル前の行と、生成に失敗した行がこの状態になる
      const name = await upload(pngFile())
      await prisma.image.update({ where: { name }, data: { thumb: null } })

      const [req, ctx] = thumbRequest(name)
      const res = await GET(req, ctx)

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/png')
      const bytes = Buffer.from(await res.arrayBuffer())
      expect(bytes.equals(PNG_BYTES)).toBe(true)
    })

    test('代替で原寸を返すときは immutable にしない (後でサムネに入れ替わる)', async () => {
      // ここを immutable にすると、バックフィル後も閲覧者のブラウザが
      // 数 MB の原寸を 1 年掴んだままになる
      const name = await upload(pngFile())
      await prisma.image.update({ where: { name }, data: { thumb: null } })

      const [req, ctx] = thumbRequest(name)
      const res = await GET(req, ctx)

      expect(res.headers.get('cache-control')).not.toContain('immutable')
      expect(res.headers.get('cache-control')).toContain('max-age=60')
    })

    test('?thumb=1 でも存在しない画像は 404 (代替に落ちて 200 にしない)', async () => {
      const [req, ctx] = thumbRequest('00000000-0000-4000-8000-000000000000.png')
      const res = await GET(req, ctx)

      expect(res.status).toBe(404)
    })

    // 動くサムネ (docs/72-動画アニメサムネ計画.md)。静止 poster と同じ ?thumb=1 の
    // 口に相乗りするが、返すのは別の列で、無いときの振る舞いも違う

    test('コマを添えた動画は動くサムネを作り、?anim=1 で配る', async () => {
      const res = await POST(videoUploadRequest(null, await animFrames(6)))
      expect(res.status).toBe(200)
      const name = (await res.json()).data.url.split('/').pop() as string
      created.push(name)

      const [req, ctx] = animRequest(name)
      const animRes = await GET(req, ctx)

      expect(animRes.status).toBe(200)
      expect(animRes.headers.get('content-type')).toBe('image/webp')
      expect(animRes.headers.get('cache-control')).toContain('immutable')
      // 中身が本当にアニメであること (静止 webp を配っていない)
      const bytes = new Uint8Array(await animRes.arrayBuffer())
      const { isAnimatedWebp } = await import('@/lib/video/videoAnim')
      expect(isAnimatedWebp(bytes)).toBe(true)
    })

    test('コマが足りない動画は静止 poster だけを持つ (アップロードは成功)', async () => {
      // 抽出が途中で打ち切られた端末。動くサムネが作れなくても静止まで
      // 巻き添えにしない (一覧から絵が消えない)
      const poster = (await animFrames(1))[0]
      const res = await POST(videoUploadRequest(poster, await animFrames(2)))
      expect(res.status).toBe(200)
      const name = (await res.json()).data.url.split('/').pop() as string
      created.push(name)

      const [thumbReq, thumbCtx] = thumbRequest(name)
      expect((await GET(thumbReq, thumbCtx)).status).toBe(200)

      const [animReq, animCtx] = animRequest(name)
      expect((await GET(animReq, animCtx)).status).toBe(404)
    })

    test('動くサムネが無いときは 404 (静止サムネで代替しない)', async () => {
      // 表示側は 404 を「静止のままでよい」の合図に使う。ここで静止を返すと
      // 差し替えが効いたのか判らず、未生成の動画に要求を出し続けることになる
      const name = await upload(pngFile())

      const [req, ctx] = animRequest(name)
      const res = await GET(req, ctx)

      expect(res.status).toBe(404)
      expect(res.headers.get('cache-control')).not.toContain('immutable')
    })

    test('上限を超える枚数のコマを送っても動画本体は通る', async () => {
      // 余分なコマは黙って捨てる。動くサムネのために動画の保存を失敗させない
      const res = await POST(
        videoUploadRequest(null, await animFrames(MAX_VIDEO_ANIM_FRAMES + 5)),
      )

      expect(res.status).toBe(200)
      created.push((await res.json()).data.url.split('/').pop() as string)
    })

    test('アップロードした画像は DB に保存される (volume ではなく)', async () => {
      const name = await upload(pngFile())

      const row = await prisma.image.findUnique({ where: { name } })
      expect(row).not.toBeNull()
      expect(row?.mime).toBe('image/png')
      expect(Buffer.from(row?.data as Uint8Array).equals(PNG_BYTES)).toBe(true)
    })

    test('同一オリジンの POST は許可する', async () => {
      await upload(pngFile(), { origin: 'http://localhost', host: 'localhost' })
    })

    test('GET: 画像応答に長期キャッシュと nosniff ヘッダを付ける', async () => {
      const name = await upload(pngFile())
      const [req, ctx] = getRequest(name)
      const res = await GET(req, ctx)
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      // private … 共有キャッシュ (プロキシ) に置かせない (docs/22 §6)。
      // 未ログインでも取れる口ができた以上、public のままにはしない
      expect(res.headers.get('cache-control')).toBe(
        'private, max-age=31536000, immutable',
      )
    })

    test('GET: 存在しない画像は 404 を返す', async () => {
      const [req, ctx] = getRequest('00000000-0000-4000-8000-000000000000.png')
      const res = await GET(req, ctx)
      expect(res.status).toBe(404)
    })

    // 未ログインの GET (docs/22-ノート公開計画.md §6)。
    // ここを閉じたままだと公開ノートの画像だけが割れ、公開が半分しか効かない。
    // 逆に開けすぎると非公開ノートの写真が漏れる。3 通りとも確かめる。
    describe('未ログイン', () => {
      // 画像を 1 枚上げ、その URL を本文に貼ったノートを作る
      async function noteWithImage(
        itemNo: string,
        state: { publicAt: Date | null; deletedAt?: Date | null },
      ): Promise<string> {
        const name = await upload(pngFile())
        await prisma.item.upsert({
          where: { itemNo },
          update: {
            memo: `写真 ![](/api/images/${name})`,
            publicAt: state.publicAt,
            deletedAt: state.deletedAt ?? null,
          },
          create: {
            itemNo,
            memo: `写真 ![](/api/images/${name})`,
            publicAt: state.publicAt,
            deletedAt: state.deletedAt ?? null,
          },
        })
        noteItemNos.push(itemNo)
        // ここまではログイン済みで用意する。検証だけを未ログインで行う
        mocks.sessionToken = null
        return name
      }

      test('公開ノートに貼った画像は配る', async () => {
        const name = await noteWithImage(`${TEST_PREFIX}pub`, {
          publicAt: new Date(),
        })

        const [req, ctx] = getRequest(name)
        const res = await GET(req, ctx)

        expect(res.status).toBe(200)
        const bytes = Buffer.from(await res.arrayBuffer())
        expect(bytes.equals(PNG_BYTES)).toBe(true)
      })

      test('非公開ノートに貼った画像は 401 (名前を知っていても配らない)', async () => {
        const name = await noteWithImage(`${TEST_PREFIX}priv`, {
          publicAt: null,
        })

        const [req, ctx] = getRequest(name)
        const res = await GET(req, ctx)

        expect(res.status).toBe(401)
      })

      // サムネは一覧のための別の口だが、認可は原寸とまったく同じでなければ
      // ならない。?thumb=1 を付けるだけで非公開の写真が取れては元も子もない
      test('非公開ノートの画像は ?thumb=1 でも 401', async () => {
        const name = await noteWithImage(`${TEST_PREFIX}privt`, {
          publicAt: null,
        })

        const [req, ctx] = thumbRequest(name)
        const res = await GET(req, ctx)

        expect(res.status).toBe(401)
      })

      test('公開ノートの画像は ?thumb=1 でも配る', async () => {
        const name = await noteWithImage(`${TEST_PREFIX}pubt`, {
          publicAt: new Date(),
        })

        const [req, ctx] = thumbRequest(name)
        const res = await GET(req, ctx)

        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe('image/webp')
      })

      // isPublicItem() と同じ規則 (docs/22 §3)。捨てたノートの写真が
      // 公開され続けるほうが驚きが大きい
      test('ゴミ箱のノートに貼った画像は、公開済みでも 401', async () => {
        const name = await noteWithImage(`${TEST_PREFIX}trash`, {
          publicAt: new Date(),
          deletedAt: new Date(),
        })

        const [req, ctx] = getRequest(name)
        const res = await GET(req, ctx)

        expect(res.status).toBe(401)
      })

      test('どのノートにも貼られていない画像は 401', async () => {
        const name = await upload(pngFile())
        mocks.sessionToken = null

        const [req, ctx] = getRequest(name)
        const res = await GET(req, ctx)

        expect(res.status).toBe(401)
      })
    })
  },
)
