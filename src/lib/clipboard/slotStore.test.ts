import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CLIPBOARD_TTL_MS } from './slot'

// prisma の clipboardSlot を 1 行だけ持つ偽物に差し替え、store の分岐
// (期限切れで消す・文字と画像の排他・上書き) を実 DB なしで確かめる
interface Row {
  userName: string
  text: string | null
  mime: string | null
  data: Uint8Array | null
  name: string | null
  bytes: number
  updatedAt: Date
}

const mocks = vi.hoisted(() => ({
  row: null as Row | null,
  deleted: [] as string[],
  wheres: [] as Array<Record<string, unknown>>,
  now: new Date('2026-10-25T12:00:00.000Z'),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    clipboardSlot: {
      findUnique: async ({ where }: { where: { userName: string } }) =>
        mocks.row?.userName === where.userName ? mocks.row : null,
      upsert: async ({ where, create }: { where: { userName: string }; create: Omit<Row, 'updatedAt'> }) => {
        mocks.row = { ...create, userName: where.userName, updatedAt: mocks.now }
        return mocks.row
      },
      deleteMany: async ({
        where,
      }: {
        where: { userName?: string; updatedAt?: Date | { lte: Date } }
      }) => {
        mocks.wheres.push(where)
        // 本物と同じく、where の全部に合う行だけを消す
        const hit =
          mocks.row !== null &&
          (where.userName === undefined || mocks.row.userName === where.userName) &&
          (where.updatedAt === undefined ||
            (where.updatedAt instanceof Date
              ? where.updatedAt.getTime() === mocks.row.updatedAt.getTime()
              : mocks.row.updatedAt.getTime() <= where.updatedAt.lte.getTime()))
        if (where.userName !== undefined) {
          mocks.deleted.push(where.userName)
        }
        if (hit) {
          mocks.row = null
        }
        return { count: hit ? 1 : 0 }
      },
    },
  },
}))

const { clearExpiredSlot, clearSlot, readSlotMedia, readSlotMeta, writeSlotMedia, writeSlotText } = await import(
  './slotStore'
)

const USER = 'tommie'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

beforeEach(() => {
  mocks.row = null
  mocks.deleted = []
  mocks.wheres = []
})

describe('writeSlotText', () => {
  test('文字を入れ、画像の列は空にしてメタを返す', async () => {
    const meta = await writeSlotText(USER, 'あいう')

    expect(meta).toEqual({
      kind: 'text',
      bytes: 9,
      updatedAt: mocks.now.toISOString(),
      text: 'あいう',
    })
    expect(mocks.row).toMatchObject({ text: 'あいう', mime: null, data: null })
  })

  // 1 枠だけ。画像が入っていても、文字で上書きされれば画像は残らない
  test('画像の上に文字を書くと画像は消える', async () => {
    await writeSlotMedia(USER, 'image/png', PNG)
    await writeSlotText(USER, 'x')

    expect(mocks.row).toMatchObject({ text: 'x', mime: null, data: null })
  })
})

describe('writeSlotMedia', () => {
  test('画像を入れ、文字の列は空にしてメタを返す (中身は載せない)', async () => {
    await writeSlotText(USER, 'x')

    const meta = await writeSlotMedia(USER, 'image/png', PNG)

    expect(meta).toEqual({
      kind: 'image',
      bytes: 4,
      updatedAt: mocks.now.toISOString(),
      mime: 'image/png',
    })
    expect(mocks.row).toMatchObject({ text: null, mime: 'image/png', bytes: 4 })
  })
})

describe('書き込み時の掃除', () => {
  // 読まれない枠は読み出しの掃除が働かない。置いたきりの平文を 10 分以上残さないため、
  // 書くついでに期限切れの行をまとめて消す (常駐の掃除役は置かない)
  test('書くたびに、10 分より古い行をまとめて消す', async () => {
    await writeSlotText(USER, 'x')

    const sweep = mocks.wheres.find((w) => w.userName === undefined)
    const cutoff = (sweep?.updatedAt as { lte: Date }).lte
    expect(Math.abs(Date.now() - cutoff.getTime() - CLIPBOARD_TTL_MS)).toBeLessThan(5000)
  })

  test('掃除は書き込みより先に行う (いま書く行を巻き込まない)', async () => {
    await writeSlotMedia(USER, 'image/png', PNG)

    expect(mocks.row).not.toBeNull()
  })
})

describe('期限切れの削除と書き込みの競合', () => {
  // 期限切れを見つけてから消すまでの間に別の端末が書き直すと、userName だけで消すと
  // 新しい中身まで消える。消すのは「見たその版」(updatedAt が一致する行) だけにする
  test('期限切れの削除は、見た版の時刻を条件に含める', async () => {
    await writeSlotText(USER, 'old')
    const later = new Date(mocks.now.getTime() + CLIPBOARD_TTL_MS)
    mocks.wheres = []

    await readSlotMeta(USER, later)

    expect(mocks.wheres).toEqual([{ userName: USER, updatedAt: mocks.now }])
  })

  test('書き直されていれば (版が違えば) 消さない', async () => {
    await writeSlotText(USER, 'old')
    const later = new Date(mocks.now.getTime() + CLIPBOARD_TTL_MS)
    // 読んだ後・消す前に別端末が書き直した状況: 行の版だけが進んでいる
    const stale = mocks.row
    if (stale) {
      mocks.row = { ...stale, updatedAt: later }
    }

    const deleted = await clearExpiredSlot(USER, mocks.now)

    expect(deleted).toBeUndefined()
    expect(mocks.row).not.toBeNull()
  })
})

describe('ファイルの種類は mime から決まる', () => {
  test.each([
    ['video/mp4', 'video'],
    ['audio/mpeg', 'audio'],
    ['application/pdf', 'pdf'],
    ['text/csv; charset=utf-8', 'textfile'],
    ['image/heic', 'image'],
    ['application/octet-stream', 'file'],
  ])('%s は %s', async (mime, kind) => {
    const meta = await writeSlotMedia(USER, mime, PNG)

    expect(meta).toMatchObject({ kind, mime })
    expect(await readSlotMeta(USER, mocks.now)).toMatchObject({ kind, mime })
  })

  // mime が無い行 (文字でもファイルでもない) は壊れた行。「無い」と見なす
  test('mime も文字も無い行は無いものとして扱う', async () => {
    mocks.row = {
      userName: USER,
      text: null,
      mime: null,
      data: PNG,
      name: null,
      bytes: 4,
      updatedAt: mocks.now,
    }

    expect(await readSlotMeta(USER, mocks.now)).toBeNull()
  })
})

describe('ファイル名', () => {
  test('名前つきで置くとメタに載り、読み出しでも返る', async () => {
    const meta = await writeSlotMedia(USER, 'application/octet-stream', PNG, '成績.xlsx')

    expect(meta).toMatchObject({ kind: 'file', name: '成績.xlsx' })
    expect(await readSlotMeta(USER, mocks.now)).toMatchObject({ name: '成績.xlsx' })
    expect(await readSlotMedia(USER, mocks.now)).toMatchObject({ name: '成績.xlsx' })
  })

  test('名前が無ければメタに name を載せない', async () => {
    const meta = await writeSlotMedia(USER, 'image/png', PNG)

    expect(meta).not.toHaveProperty('name')
  })

  // 文字で上書きしたら、前のファイルの名前を引きずらない
  test('文字で上書きすると名前は消える', async () => {
    await writeSlotMedia(USER, 'application/octet-stream', PNG, 'a.zip')
    await writeSlotText(USER, 'x')

    expect(mocks.row).toMatchObject({ text: 'x', name: null })
  })
})

describe('readSlotMeta', () => {
  test('何も無ければ null', async () => {
    expect(await readSlotMeta(USER, mocks.now)).toBeNull()
  })

  test('生きている文字は本文つきで返す', async () => {
    await writeSlotText(USER, 'abc')

    expect(await readSlotMeta(USER, mocks.now)).toEqual({
      kind: 'text',
      bytes: 3,
      updatedAt: mocks.now.toISOString(),
      text: 'abc',
    })
  })

  test('期限が切れていれば null を返し、行を消す', async () => {
    await writeSlotText(USER, 'abc')
    const later = new Date(mocks.now.getTime() + CLIPBOARD_TTL_MS)

    expect(await readSlotMeta(USER, later)).toBeNull()
    expect(mocks.deleted).toEqual([USER])
    expect(mocks.row).toBeNull()
  })

  // 別の人の枠は見えない (userName で仕切る)
  test('他の利用者の枠は読めない', async () => {
    await writeSlotText('other', 'secret')

    expect(await readSlotMeta(USER, mocks.now)).toBeNull()
  })
})

describe('readSlotMedia', () => {
  test('生きている画像は mime とバイト列を返す', async () => {
    await writeSlotMedia(USER, 'image/png', PNG)

    expect(await readSlotMedia(USER, mocks.now)).toEqual({ mime: 'image/png', data: PNG, name: null })
  })

  test('文字の枠には画像が無い', async () => {
    await writeSlotText(USER, 'abc')

    expect(await readSlotMedia(USER, mocks.now)).toBeNull()
  })

  test('期限切れは null で、行を消す', async () => {
    await writeSlotMedia(USER, 'image/png', PNG)

    const later = new Date(mocks.now.getTime() + CLIPBOARD_TTL_MS)
    expect(await readSlotMedia(USER, later)).toBeNull()
    expect(mocks.deleted).toEqual([USER])
  })
})

describe('clearSlot', () => {
  test('枠を消す', async () => {
    await writeSlotText(USER, 'abc')

    await clearSlot(USER)

    expect(mocks.row).toBeNull()
  })

  test('無くても投げない', async () => {
    await expect(clearSlot(USER)).resolves.toBeUndefined()
  })
})
