import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  backfillNotes,
  commitNote,
  noteAtCommit,
  noteAtHead,
  noteHistory,
  removeNotes,
} from './notesRepo'

const OID = /^[0-9a-f]{40}$/

// 実 git を一時ディレクトリで回す (モックしない)。この層の価値は
// 「git 本物と同じに壊れる・動く」ことなので、置き換えたら意味がない。
describe('notesRepo (実 git)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'qr-git-test-'))
    process.env.QR_GIT_DIR = dir
  })

  afterEach(async () => {
    delete process.env.QR_GIT_DIR
    await rm(dir, { recursive: true, force: true })
  })

  test('commitNote records a version and noteAtHead returns it verbatim', async () => {
    const oid = await commitNote('4518', '2SC1815\n#bjt\n', 'update 4518')
    expect(oid).toMatch(OID)
    // 末尾改行の有無まで往復で保たれる (復元が可逆であることの要)
    expect(await noteAtHead('4518')).toBe('2SC1815\n#bjt\n')
  })

  test('commitNote returns null when nothing changed (履歴を汚さない)', async () => {
    await commitNote('4518', 'a', 'first')
    expect(await commitNote('4518', 'a', 'again')).toBeNull()
    expect(await noteHistory('4518')).toHaveLength(1)
  })

  test('noteHistory lists versions newest first with the parent chain', async () => {
    const first = await commitNote('4518', 'v1', 'first')
    const second = await commitNote('4518', 'v2', 'second')

    const history = await noteHistory('4518')

    expect(history.map((c) => c.oid)).toEqual([second, first])
    expect(history[0]?.parentOid).toBe(first)
    expect(history[0]?.message).toBe('second')
    // ISO 8601 で返す (画面が formatJstDateTime に渡せる形)
    expect(new Date(history[0]?.date ?? '').getTime()).not.toBeNaN()
  })

  test('noteAtCommit returns the content of that version', async () => {
    const first = await commitNote('4518', 'v1', 'first')
    await commitNote('4518', 'v2', 'second')

    expect(first === null ? null : await noteAtCommit('4518', first)).toBe('v1')
  })

  test('noteAtCommit rejects non-oid revisions (git への口を閉じる)', async () => {
    await commitNote('4518', 'v1', 'first')
    await expect(noteAtCommit('4518', 'HEAD')).rejects.toThrow()
  })

  test('noteAtCommit throws for a well-formed but unknown oid (壊れを null に畳まない)', async () => {
    // 「その版にファイルが無い」(null) と「リビジョンが解決できない」(throw) は
    // 別物。後者まで null に畳むと、リポジトリ破損が「削除された」に化ける
    await commitNote('4518', 'v1', 'first')
    await expect(noteAtCommit('4518', 'deadbeef'.repeat(5))).rejects.toThrow()
  })

  test('histories of different notes do not mix', async () => {
    await commitNote('1', 'note1', 'update 1')
    await commitNote('2', 'note2', 'update 2')

    expect(await noteHistory('1')).toHaveLength(1)
    expect(await noteHistory('2')).toHaveLength(1)
  })

  test('a never-committed note has no history and no head content', async () => {
    await commitNote('1', 'note1', 'update 1')

    expect(await noteHistory('9999')).toEqual([])
    expect(await noteAtHead('9999')).toBeNull()
  })

  test('removeNotes adds a tombstone but keeps old versions readable', async () => {
    const first = await commitNote('4518', 'v1', 'first')

    const tombstone = await removeNotes(['4518'], 'delete 4518')

    expect(tombstone).toMatch(OID)
    expect(await noteAtHead('4518')).toBeNull()
    // 墓石も履歴に並ぶ (「この版で消えた」が見える)
    expect(await noteHistory('4518')).toHaveLength(2)
    expect(first === null ? null : await noteAtCommit('4518', first)).toBe('v1')
  })

  test('removeNotes skips notes that were never committed', async () => {
    expect(await removeNotes(['9999'], 'delete 9999')).toBeNull()
  })

  test('backfillNotes imports everything in one commit, idempotently', async () => {
    const notes = [
      { itemNo: '1', memo: 'note1' },
      { itemNo: '2', memo: 'note2' },
    ]

    const oid = await backfillNotes(notes, 'backfill')

    expect(oid).toMatch(OID)
    expect(await noteAtHead('1')).toBe('note1')
    expect(await noteHistory('1')).toHaveLength(1)
    expect(await noteHistory('2')).toHaveLength(1)
    // 2 回目は変化がないので何もコミットしない
    expect(await backfillNotes(notes, 'backfill')).toBeNull()
  })

  // 改名 (QR search → QR Note) で identity の定数を変えたときに効くようにする。
  // init のときだけ書いていた頃は、作った当時の名前がローカル設定に焼き付き、
  // 既に在るリポジトリ (= 本番) は古い名前で署名し続けた
  test('既に在るリポジトリの author も現在の identity に揃える', async () => {
    await commitNote('4518', 'v1', 'first')

    // 改名前に作られたリポジトリを再現する
    const git = simpleGit(dir)
    await git.addConfig('user.name', 'qr-search')
    await git.addConfig('user.email', 'qr-search@localhost')

    // identity を書くのは 1 プロセスにつき 1 回なので、開き直しを再現する
    vi.resetModules()
    const { commitNote: reopened } = await import('./notesRepo')
    await reopened('4518', 'v2', 'second')

    expect((await git.raw(['log', '-1', '--format=%an <%ae>'])).trim()).toBe(
      'qr-note <qr-note@localhost>',
    )
  })

  // 逆に、合っているなら書きに行かない。履歴や過去の版を読むだけの操作も
  // 同じ経路を通るので、毎プロセス必ず書くと、ディスクが埋まった程度のことで
  // 「読むことすらできない」に化ける
  test('identity が合っていれば読み取りで設定を書かない', async () => {
    await commitNote('4518', 'v1', 'first')
    const configPath = join(dir, '.git', 'config')
    const before = (await stat(configPath)).mtimeMs

    vi.resetModules()
    const { noteHistory: reopened } = await import('./notesRepo')
    expect(await reopened('4518')).toHaveLength(1)

    expect((await stat(configPath)).mtimeMs).toBe(before)
  })

  test('concurrent commits are serialized (プロセス内キュー)', async () => {
    const [a, b] = await Promise.all([
      commitNote('1', 'a', 'update 1'),
      commitNote('2', 'b', 'update 2'),
    ])

    expect(a).toMatch(OID)
    expect(b).toMatch(OID)
    expect(await noteHistory('1')).toHaveLength(1)
    expect(await noteHistory('2')).toHaveLength(1)
  })
})
