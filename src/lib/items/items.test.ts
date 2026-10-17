import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { setItemPublic as SetItemPublicFn } from './flags'
import type {
  countFolderTotals as CountFolderTotalsFn,
  findListNeighbors as FindListNeighborsFn,
  getItem as GetItemFn,
  isPublicImageName as IsPublicImageNameFn,
  listTags as ListTagsFn,
} from './read'
import type {
  countTaskProgress as CountTaskProgressFn,
  searchItemProps as SearchItemPropsFn,
  searchItems as SearchItemsFn,
} from './search'
import type {
  countTrashedItems as CountTrashedItemsFn,
  countTrashedMatches as CountTrashedMatchesFn,
  listTrashedItems as ListTrashedItemsFn,
  purgeItems as PurgeItemsFn,
  restoreItems as RestoreItemsFn,
  trashItems as TrashItemsFn,
} from './trash'
import type {
  modifyMemo as ModifyMemoFn,
  saveItemIfUnchanged as SaveItemIfUnchangedFn,
  upsertMemo as UpsertMemoFn,
} from './write'
import type { searchItemChecks as SearchItemChecksFn } from '@/lib/matrix/matrixQuery'
import { differsOnlyInTaskMarks, toggleTaskLine } from '@/lib/markdown/taskCheckbox'
import type { PrismaClient } from '@/generated/prisma/client'

// DB を実際に叩く統合テスト。
// 通常の `npm test` (および doDeploy の lint+test) では走らせず、
// DATABASE_URL があり かつ RUN_DB_TESTS=1 のときだけ実行する。
// db.ts はモジュール読み込み時に DATABASE_URL を要求するため、
// import は beforeAll 内で動的に行い、skip 時に評価されないようにする。
const runDbTests =
  !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === '1'

// 実データと衝突しないよう、テストのノートの id は固定の UUID 接頭辞で揃え、
// 後始末で消す (docs/107: id は UUID 型なので文字列の接頭辞は使えない)。
// 本文の語・タグは今までどおり zzft… で、他のノートに当たらないようにしている
const ID_PREFIX = 'f7f7f7f7-0000-7000-8000-'

// 短い名前 (英小文字・数字 6 文字まで) をテスト用の UUID にする。末尾 12 桁に
// 名前の文字コードを左詰めで入れるので、名前の辞書順 = id 順 (= 登録順) になる
function hexOf(key: string): string {
  return Array.from(key, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
}

function tid(key: string): string {
  if (!/^[a-z0-9]{1,6}$/.test(key)) {
    throw new Error(`テスト用 id の名前が長すぎるか形が違う: ${key}`)
  }
  return `${ID_PREFIX}${hexOf(key).padEnd(12, '0')}`
}

// tid(名前) のうち、名前が key で始まるものすべてに共通する接頭辞
function tidPrefix(key: string): string {
  return `${ID_PREFIX}${hexOf(key)}`
}

describe.skipIf(!runDbTests)(
  'searchItems (integration; needs DATABASE_URL + RUN_DB_TESTS=1)',
  () => {
    let searchItems: typeof SearchItemsFn
    let searchItemProps: typeof SearchItemPropsFn
    let searchItemChecks: typeof SearchItemChecksFn
    let upsertMemo: typeof UpsertMemoFn
    let saveItemIfUnchanged: typeof SaveItemIfUnchangedFn
    let modifyMemo: typeof ModifyMemoFn
    let listTags: typeof ListTagsFn
    let getItem: typeof GetItemFn
    let trashItems: typeof TrashItemsFn
    let restoreItems: typeof RestoreItemsFn
    let purgeItems: typeof PurgeItemsFn
    let listTrashedItems: typeof ListTrashedItemsFn
    let countTrashedItems: typeof CountTrashedItemsFn
    let countTrashedMatches: typeof CountTrashedMatchesFn
    let countTaskProgress: typeof CountTaskProgressFn
    let countFolderTotals: typeof CountFolderTotalsFn
    let findListNeighbors: typeof FindListNeighborsFn
    let setItemPublic: typeof SetItemPublicFn
    let isPublicImageName: typeof IsPublicImageNameFn
    let prisma: PrismaClient

    const seed = [
      { itemId: tid('a1'), memo: 'zzfttoken zzftonlya1 ライト RITEX', url: '', mode: 'memo' as const },
      { itemId: tid('a2'), memo: 'zzfttoken ライト', url: '', mode: 'memo' as const },
      { itemId: tid('a3'), memo: 'zzfttoken ２ＳＣ１８１５', url: '', mode: 'memo' as const },
      {
        itemId: tid('a4'),
        memo: '',
        url: 'https://example.com/zzfturltoken',
        mode: 'url' as const,
      },
      {
        itemId: tid('t1'),
        memo: 'zzfttagmemo #zzfttag1 #zzftshared',
        url: '',
        mode: 'memo' as const,
        tags: ['zzfttag1', 'zzftshared'],
      },
      {
        itemId: tid('t2'),
        memo: 'zzfttagmemo #zzfttag2 #zzftshared',
        url: '',
        mode: 'memo' as const,
        tags: ['zzfttag2', 'zzftshared'],
      },
      // 特性表用: 同じタグを共有し、片方だけ余分な列 (Vce) を持つ。
      {
        itemId: tid('p1'),
        memo: '2SC1815\n#zzftbjt\nhFE=400 Vf=650mV',
        url: '',
        mode: 'memo' as const,
        tags: ['zzftbjt'],
        props: [
          { key: 'hfe', label: 'hFE', value: '400' },
          { key: 'vf', label: 'Vf', value: '650mV' },
        ],
      },
      {
        itemId: tid('p2'),
        memo: '2SC2712-Y\n#zzftbjt\nhFE=208 Vce=50V',
        url: '',
        mode: 'memo' as const,
        tags: ['zzftbjt'],
        props: [
          { key: 'hfe', label: 'hFE', value: '208' },
          { key: 'vce', label: 'Vce', value: '50V' },
        ],
      },
      // 同じタグだがプロパティ行なし → 表には出さない。
      {
        itemId: tid('p3'),
        memo: 'プロパティのないノート\n#zzftbjt',
        url: '',
        mode: 'memo' as const,
        tags: ['zzftbjt'],
      },
      // チェック状態の絞り込み用 (docs/56-チェック検索計画.md)。
      // 派生列は upsertMemo が数えるので、ここでは seed に直接書く。
      {
        itemId: tid('k1'),
        memo: 'zzftcheck\n- [ ] まだ',
        url: '',
        mode: 'memo' as const,
        taskTodo: 1,
        taskDone: 0,
      },
      {
        itemId: tid('k2'),
        memo: 'zzftcheck\n- [x] おわり',
        url: '',
        mode: 'memo' as const,
        taskTodo: 0,
        taskDone: 1,
      },
      {
        itemId: tid('k3'),
        memo: 'zzftcheck\n- [ ] まだ\n- [x] おわり',
        url: '',
        mode: 'memo' as const,
        taskTodo: 1,
        taskDone: 1,
      },
      // チェックのないノート (どちらにも出ない)
      {
        itemId: tid('k4'),
        memo: 'zzftcheck チェックなし',
        url: '',
        mode: 'memo' as const,
      },
      // 学習進捗と前後ナビ用 (docs/60-学習進捗計画.md)。チェック 2 つで
      // 未着手 / 自信なし / 習得済み の 3 状態を作る。
      // zzftcheck 系とは別トークンにする — あちらは後続のテストが
      // zzftcheck2 のノートを足すため、部分一致で巻き込まれる
      {
        itemId: tid('n1'),
        memo: 'zzftnav 問1\n- [ ] 学習済み\n- [ ] 自信あり',
        url: '',
        mode: 'memo' as const,
        taskTodo: 2,
        taskDone: 0,
      },
      {
        itemId: tid('n2'),
        memo: 'zzftnav 問2\n- [x] 学習済み\n- [ ] 自信あり',
        url: '',
        mode: 'memo' as const,
        taskTodo: 1,
        taskDone: 1,
      },
      {
        itemId: tid('n3'),
        memo: 'zzftnav 問3\n- [x] 学習済み\n- [x] 自信あり',
        url: '',
        mode: 'memo' as const,
        taskTodo: 0,
        taskDone: 2,
      },
      // チェックを持たないので進捗の母数に入らない
      {
        itemId: tid('n4'),
        memo: 'zzftnav 問4 チェックなし',
        url: '',
        mode: 'memo' as const,
      },
    ]

    // id は uuid 型なので Prisma の startsWith は使えず、LIKE は PGroonga に
    // 乗っ取られる (全文検索の正規化が効く)。素のバイト比較の position() で見る
    const deleteTestNotes = () =>
      prisma.$executeRaw`DELETE FROM items WHERE position(${ID_PREFIX} in id::text) = 1`

    beforeAll(async () => {
      ;({ searchItems, searchItemProps, countTaskProgress } = await import('./search'))
      ;({ searchItemChecks } = await import('@/lib/matrix/matrixQuery'))
      ;({ upsertMemo, saveItemIfUnchanged, modifyMemo } = await import('./write'))
      ;({
        listTags,
        getItem,
        countFolderTotals,
        findListNeighbors,
        isPublicImageName,
      } = await import('./read'))
      ;({
        trashItems,
        restoreItems,
        purgeItems,
        listTrashedItems,
        countTrashedItems,
        countTrashedMatches,
      } = await import('./trash'))
      ;({ setItemPublic } = await import('./flags'))
      ;({ prisma } = await import('@/lib/db'))
      await deleteTestNotes()
      for (const s of seed) {
        await prisma.item.create({ data: s })
      }
    })

    afterAll(async () => {
      if (!prisma) return
      await deleteTestNotes()
      await prisma.$disconnect()
    })

    const itemIds = (r: { items: { itemId: string }[] }) =>
      r.items.map((i) => i.itemId).sort()

    test('matches memo content across rows sharing a token (全文検索)', async () => {
      const r = await searchItems('zzfttoken', 1)
      expect(itemIds(r)).toEqual([tid('a1'), tid('a2'), tid('a3')])
    })

    test('AND-searches space-separated terms (両方を含む行だけ)', async () => {
      const r = await searchItems('zzfttoken RITEX', 1)
      expect(itemIds(r)).toEqual([tid('a1')])
    })

    // OR は seed 専用トークンだけで検証する (実データと衝突させない)。
    test('OR-searches with the OR keyword (どちらかを含む行)', async () => {
      const r = await searchItems('zzftonlya1 OR zzfturltoken', 1)
      expect(itemIds(r)).toEqual([tid('a1'), tid('a4')])
    })

    test('OR-searches with the pipe operator', async () => {
      const r = await searchItems('zzftonlya1|zzfturltoken', 1)
      expect(itemIds(r)).toEqual([tid('a1'), tid('a4')])
    })

    test('OR-searches with full-width operators (｜ / ＯＲ)', async () => {
      // 日本語入力の全角モードのまま打っても半角と同じに効く
      expect(itemIds(await searchItems('zzftonlya1｜zzfturltoken', 1))).toEqual([
        tid('a1'),
        tid('a4'),
      ])
      expect(itemIds(await searchItems('zzftonlya1 ＯＲ zzfturltoken', 1))).toEqual([
        tid('a1'),
        tid('a4'),
      ])
    })

    test('space binds tighter than OR (AND-group OR term)', async () => {
      // (zzfttoken AND zzftonlya1) OR zzfturltoken
      const r = await searchItems('zzfttoken zzftonlya1 OR zzfturltoken', 1)
      expect(itemIds(r)).toEqual([tid('a1'), tid('a4')])
    })

    // NOT / 括弧も seed 専用トークンとの AND で挟んで検証する。裸の否定は
    // 「それ以外すべて」になり実データを巻き込むため。
    describe('NOT and parentheses', () => {
      test('! excludes rows matching the negated term', async () => {
        const r = await searchItems('zzfttoken !RITEX', 1)
        expect(itemIds(r)).toEqual([tid('a2'), tid('a3')])
      })

      test('! negates a parenthesized OR group', async () => {
        const r = await searchItems('zzfttoken !(RITEX OR 2sc1815)', 1)
        expect(itemIds(r)).toEqual([tid('a2')])
      })

      test('parentheses group an OR so the AND applies to the whole group', async () => {
        const r = await searchItems('zzfttoken (RITEX OR 2sc1815)', 1)
        expect(itemIds(r)).toEqual([tid('a1'), tid('a3')])
      })

      test('! excludes a tag', async () => {
        const r = await searchItems('#zzftshared !#zzfttag1', 1)
        expect(itemIds(r)).toEqual([tid('t2')])
      })

      test('! applies to one operand only, not the whole AND-group', async () => {
        // zzfttoken AND NOT(RITEX) — zzfttoken 自体は否定されない
        const r = await searchItems('!RITEX zzfttoken', 1)
        expect(itemIds(r)).toEqual([tid('a2'), tid('a3')])
      })

      test('a dangling ! is ignored (寛容パース)', async () => {
        const r = await searchItems('zzfttoken !', 1)
        expect(itemIds(r)).toEqual([tid('a1'), tid('a2'), tid('a3')])
      })

      test('an unclosed ( is auto-closed (寛容パース)', async () => {
        const r = await searchItems('zzfttoken (RITEX OR 2sc1815', 1)
        expect(itemIds(r)).toEqual([tid('a1'), tid('a3')])
      })

      test('the props table honours a negated tag', async () => {
        const { rows } = await searchItemProps('#zzftbjt !2SC1815')
        expect(rows.map((r) => r.itemId)).toEqual([tid('p2')])
      })
    })

    test('AND-searches with a full-width space too', async () => {
      const r = await searchItems('ライト　zzfttoken', 1)
      expect(itemIds(r)).toEqual([tid('a1'), tid('a2')])
    })

    test('normalizes full/half width and case (２ＳＣ→2sc)', async () => {
      const r = await searchItems('zzfttoken 2sc1815', 1)
      expect(itemIds(r)).toEqual([tid('a3')])
    })

    test('matches URL content', async () => {
      const r = await searchItems('zzfturltoken', 1)
      expect(itemIds(r)).toEqual([tid('a4')])
    })

    // 旧番号の前方一致 (item_no ILIKE) は外した (docs/107 §4-5)。id (UUID) の
    // 文字列は本文に無いので、検索語にしても当たらない
    test('id の文字列では引けない (前方一致は外した)', async () => {
      const r = await searchItems(ID_PREFIX.slice(0, 8), 1)
      expect(r.items.filter((i) => i.itemId.startsWith(ID_PREFIX))).toEqual([])
    })

    test('returns zero results with a clean envelope', async () => {
      const r = await searchItems('zzfttoken nonexistenttokenxyz', 1)
      expect(r.total).toBe(0)
      expect(r.items).toEqual([])
      expect(r.pageCount).toBe(1)
    })

    test('clamps an out-of-range page to the last page', async () => {
      const r = await searchItems('zzfttoken', 999)
      expect(r.page).toBe(r.pageCount)
      expect(r.items).toHaveLength(3)
    })

    test('empty query browses all items (WHERE 無し)', async () => {
      const r = await searchItems('', 1)
      expect(r.total).toBeGreaterThanOrEqual(seed.length)
    })

    // チェック状態の絞り込み (docs/56-チェック検索計画.md)。
    // 実データを巻き込まないよう、必ず seed 専用トークンと AND で使う。
    describe('is:todo / is:done', () => {
      test('is:todo は未チェックが残っているノートだけ', async () => {
        const r = await searchItems('zzftcheck is:todo', 1)
        expect(itemIds(r)).toEqual([tid('k1'), tid('k3')])
      })

      test('is:done はチェック済みがあるノートだけ', async () => {
        const r = await searchItems('zzftcheck is:done', 1)
        expect(itemIds(r)).toEqual([tid('k2'), tid('k3')])
      })

      test('!is:todo は未チェックが残っていないノート (チェック無しも含む)', async () => {
        const r = await searchItems('zzftcheck !is:todo', 1)
        expect(itemIds(r)).toEqual([tid('k2'), tid('k4')])
      })

      test('全部覚えたノートは !is:todo is:done で引ける', async () => {
        const r = await searchItems('zzftcheck !is:todo is:done', 1)
        expect(itemIds(r)).toEqual([tid('k2')])
      })

      test('引用すればリテラルの全文検索に戻る', async () => {
        // seed 語で必ず絞る。裸の `"is:todo"` だと、本文に is:todo と書いた
        // 実ノート (この機能のメモなど) ができた日に落ちる
        const r = await searchItems('zzftcheck "is:todo"', 1)
        expect(itemIds(r)).toEqual([])
      })

      // タグの無いノートの絞り込み (docs/86 §5 未分類フォルダー)
      test('is:untagged はタグの無いノートだけ', async () => {
        const r = await searchItems('zzfttoken is:untagged', 1)
        expect(itemIds(r)).toEqual([tid('a1'), tid('a2'), tid('a3')])
      })

      test('!is:untagged はタグのあるノートだけ', async () => {
        const r = await searchItems('zzfttagmemo !is:untagged', 1)
        expect(itemIds(r)).toEqual([tid('t1'), tid('t2')])
        const none = await searchItems('zzfttagmemo is:untagged', 1)
        expect(itemIds(none)).toEqual([])
      })

      // 検索フォルダーの件数 (docs/86 §5)
      test('countFolderTotals は全件と未分類を 1 回で数える', async () => {
        const totals = await countFolderTotals()
        expect(totals.total).toBeGreaterThanOrEqual(seed.length)
        expect(totals.untagged).toBeGreaterThan(0)
        expect(totals.untagged).toBeLessThanOrEqual(totals.total)
        // 件数の定義は is:untagged 検索と同じ (フォルダー = 検索のエイリアス)
        const r = await searchItems('is:untagged', 1)
        expect(totals.untagged).toBe(r.total)
      })

      // 学習の進捗 (docs/60-学習進捗計画.md §2)。
      // 分母は「検索からチェック語を外し、チェックを持つノートに絞った数」
      describe('countTaskProgress', () => {
        test('チェックを持つノートが分母、全部チェックしたものが分子', async () => {
          expect(await countTaskProgress('zzftnav is:todo')).toEqual({
            done: 1,
            total: 3,
          })
        })

        test('絞り込みが is:todo でも is:done でも母数は変わらない', async () => {
          const todo = await countTaskProgress('zzftnav is:todo')
          expect(await countTaskProgress('zzftnav is:done')).toEqual(todo)
          expect(await countTaskProgress('zzftnav !is:todo')).toEqual(todo)
          // チェック語が無くても同じ (母数は元の検索だけで決まる)
          expect(await countTaskProgress('zzftnav')).toEqual(todo)
        })

        test('チェックのないノートは分母に入らない', async () => {
          // zzftnav は 4 件ヒットするが、チェックを持つのは 3 件
          expect((await searchItems('zzftnav', 1)).total).toBe(4)
          expect((await countTaskProgress('zzftnav')).total).toBe(3)
        })

        test('当たらない検索は 0 / 0 (呼び出し側が出し分ける)', async () => {
          expect(await countTaskProgress('zzftnothinghere is:todo')).toEqual({
            done: 0,
            total: 0,
          })
        })
      })

      // 進捗の表の元データ (docs/77-進捗マトリックス計画.md §4)。
      describe('searchItemChecks', () => {
        test('チェックを持つノートだけを返す', async () => {
          const { rows } = await searchItemChecks('zzftnav')
          // zzftnav は 4 件ヒットするが、チェックを持つのは 3 件
          expect(rows.map((r) => r.itemId).sort()).toEqual([
            tid('n1'),
            tid('n2'),
            tid('n3'),
          ])
        })

        test('チェック数を本文と一緒に返す (表の 3 状態の元になる)', async () => {
          const { rows } = await searchItemChecks('zzftnav')
          const byNo = new Map(rows.map((r) => [r.itemId, r]))
          expect(byNo.get(tid('n1'))).toMatchObject({ taskTodo: 2, taskDone: 0 })
          expect(byNo.get(tid('n2'))).toMatchObject({ taskTodo: 1, taskDone: 1 })
          expect(byNo.get(tid('n3'))).toMatchObject({ taskTodo: 0, taskDone: 2 })
          expect(byNo.get(tid('n1'))?.memo).toContain('学習済み')
        })

        // 既定が番号順なのは、表から開いて前後ナビで順に回すため
        // (docs/60-学習進捗計画.md §4)。更新順だとチェックを押した瞬間に
        // ノートが先頭へ移り、前後が狂う
        test('既定は番号順で返る', async () => {
          const { rows } = await searchItemChecks('zzftnav')
          expect(rows.map((r) => r.itemId)).toEqual([
            tid('n1'),
            tid('n2'),
            tid('n3'),
          ])
        })

        test('検索式で絞れる', async () => {
          const { rows } = await searchItemChecks('zzftnav !is:todo')
          expect(rows.map((r) => r.itemId)).toEqual([tid('n3')])
        })

        test('ゴミ箱のノートは入らない', async () => {
          await trashItems([tid('n1')])
          try {
            const { rows } = await searchItemChecks('zzftnav')
            expect(rows.map((r) => r.itemId)).not.toContain(tid('n1'))
          } finally {
            await restoreItems([tid('n1')])
          }
        })

        test('当たらない検索は 0 件 (溢れも 0)', async () => {
          expect(await searchItemChecks('zzftnothinghere')).toEqual({
            rows: [],
            omitted: 0,
          })
        })
      })

      // 一覧の中の前後 (docs/60-学習進捗計画.md §4)。
      // 登録順 (registered) は id 順。tid() は名前の辞書順に id を振るので安定する
      describe('findListNeighbors', () => {
        test('一覧の並びで前後を返す', async () => {
          expect(await findListNeighbors('zzftnav', 'registered', tid('n2'))).toEqual({
            prev: tid('n1'),
            next: tid('n3'),
          })
        })

        test('端では行き先が null になる', async () => {
          expect(await findListNeighbors('zzftnav', 'registered', tid('n1'))).toEqual({
            prev: null,
            next: tid('n2'),
          })
          expect(await findListNeighbors('zzftnav', 'registered', tid('n4'))).toEqual({
            prev: tid('n3'),
            next: null,
          })
        })

        test('絞り込みに合うものだけを辿る (学習済みを飛ばす)', async () => {
          // is:todo に残るのは zzftn1 (未着手) と zzftn2 (自信なし)。
          // 習得済みの zzftn3 とチェック無しの zzftn4 は飛ばす
          expect(
            await findListNeighbors('zzftnav is:todo', 'registered', tid('n1')),
          ).toEqual({ prev: null, next: tid('n2') })
        })

        // ここが要 (docs/60 §4)。チェックを付けた直後は自分が一覧から消えるが、
        // それでも「次」は正しく次のノートを指さなければならない
        test('自分が絞り込みから外れていても前後は求まる', async () => {
          expect(
            await findListNeighbors('zzftnav is:todo', 'registered', tid('n3')),
          ).toEqual({ prev: tid('n2'), next: null })
        })

        test('未登録の itemId では前後とも null (ナビを出さない)', async () => {
          expect(
            await findListNeighbors('zzftnav', 'registered', tid('nope')),
          ).toEqual({ prev: null, next: null })
        })

        test('ゴミ箱のノートは辿らない', async () => {
          await trashItems([tid('n2')])
          try {
            expect(
              await findListNeighbors('zzftnav', 'registered', tid('n1')),
            ).toEqual({ prev: null, next: tid('n3') })
          } finally {
            await restoreItems([tid('n2')])
          }
        })
      })

      test('保存するとチェック数が追随する (派生キャッシュ)', async () => {
        await upsertMemo(tid('k5'), 'zzftcheck2\n- [ ] まだ')
        expect(itemIds(await searchItems('zzftcheck2 is:todo', 1))).toEqual([
          tid('k5'),
        ])
        await upsertMemo(tid('k5'), 'zzftcheck2\n- [x] おわり')
        expect(itemIds(await searchItems('zzftcheck2 is:todo', 1))).toEqual([])
        expect(itemIds(await searchItems('zzftcheck2 is:done', 1))).toEqual([
          tid('k5'),
        ])
      })
    })

    // オンデマンド表示 (docs/33): page N は「N ページ目だけ」ではなく
    // 「1〜N ページ目までの累積」を返す。クライアントに蓄積 state を
    // 持たせないための意味論変更。
    describe('pagination (累積読み込み)', () => {
      const TOKEN = 'zzftpagetoken'
      const NOTES = 25 // PAGE_SIZE(20) を 1 ページ分だけ超える数

      beforeAll(async () => {
        for (let i = 0; i < NOTES; i++) {
          const itemId = tid(`pn${String(i).padStart(2, '0')}`)
          await prisma.item.upsert({
            where: { itemId },
            update: { memo: TOKEN },
            create: { itemId, memo: TOKEN },
          })
        }
        // 全行を同じ updated_at にする。同時刻でも並びが揺れないこと
        // (タイブレーク) を検証するため
        await prisma.$executeRaw`
          UPDATE items SET updated_at = '2026-03-01T00:00:00Z'
          WHERE position(${tidPrefix('pn')} in id::text) = 1
        `
      })

      test('page 2 returns pages 1..2 cumulatively (先頭 20 件は page 1 と同一)', async () => {
        const p1 = await searchItems(TOKEN, 1)
        expect(p1.items).toHaveLength(20)
        expect(p1.total).toBe(NOTES)
        expect(p1.pageCount).toBe(2)

        const p2 = await searchItems(TOKEN, 2)
        expect(p2.items).toHaveLength(NOTES)
        expect(p2.items.slice(0, 20).map((i) => i.itemId)).toEqual(
          p1.items.map((i) => i.itemId),
        )
      })

      test('equal updated_at rows keep a stable order (id でタイブレーク)', async () => {
        const r = await searchItems(TOKEN, 2)
        const nos = r.items.map((i) => i.itemId)
        expect(nos).toEqual([...nos].sort())
      })
    })

    // 登録順 (docs/107 §4-6)。id は UUID v7 で先頭が時刻なので、id 順 = 作った順。
    // created_at はあえて逆向きにしておき、並びが created_at ではなく id で
    // 決まっていることを確かめる
    describe('登録順 (registered = id 順)', () => {
      const TOKEN = 'zzftregtoken'
      const KEYS = ['rg1', 'rg2', 'rg3']

      beforeAll(async () => {
        for (const [i, key] of KEYS.entries()) {
          const itemId = tid(key)
          const createdAt = new Date(Date.UTC(2026, 0, 10 - i))
          await prisma.item.upsert({
            where: { itemId },
            update: { memo: TOKEN, createdAt },
            create: { itemId, memo: TOKEN, createdAt },
          })
        }
      })

      test('registered は id の昇順', async () => {
        const r = await searchItems(TOKEN, 1, 'registered')
        expect(r.items.map((i) => i.itemId)).toEqual(KEYS.map(tid))
      })

      test('registeredDesc は id の降順', async () => {
        const r = await searchItems(TOKEN, 1, 'registeredDesc')
        expect(r.items.map((i) => i.itemId)).toEqual(KEYS.map(tid).reverse())
      })

      test('前後ナビも登録順で辿る', async () => {
        expect(await findListNeighbors(TOKEN, 'registered', tid('rg2'))).toEqual({
          prev: tid('rg1'),
          next: tid('rg3'),
        })
        expect(await findListNeighbors(TOKEN, 'registeredDesc', tid('rg2'))).toEqual({
          prev: tid('rg3'),
          next: tid('rg1'),
        })
      })
    })

    describe('tag search', () => {
      test('#tag matches items carrying that tag', async () => {
        const r = await searchItems('#zzfttag1', 1)
        expect(itemIds(r)).toEqual([tid('t1')])
      })

      test('a shared tag matches every item that has it', async () => {
        const r = await searchItems('#zzftshared', 1)
        expect(itemIds(r)).toEqual([tid('t1'), tid('t2')])
      })

      test('AND of two tags matches only items with both', async () => {
        const r = await searchItems('#zzftshared #zzfttag1', 1)
        expect(itemIds(r)).toEqual([tid('t1')])
      })

      test('OR of two tags matches either', async () => {
        const r = await searchItems('#zzfttag1 OR #zzfttag2', 1)
        expect(itemIds(r)).toEqual([tid('t1'), tid('t2')])
      })

      test('tag search is exact, not substring of memo text', async () => {
        // zzfttagmemo は本文に含まれるがタグではないのでヒットしない
        const r = await searchItems('#zzfttagmemo', 1)
        expect(itemIds(r)).toEqual([])
      })

      test('a quoted "#tag" falls back to full-text (finds the literal in memo)', async () => {
        const r = await searchItems('"#zzfttag1"', 1)
        expect(itemIds(r)).toEqual([tid('t1')])
      })
    })

    describe('props', () => {
      test('searchItems projects the props column onto the item', async () => {
        // 生 SQL の SELECT に props を足し忘れると undefined になる (型では気づけない)。
        const r = await searchItems('#zzftbjt', 1)
        const item = r.items.find((i) => i.itemId === tid('p2'))
        expect(item?.props).toEqual([
          { key: 'hfe', label: 'hFE', value: '208' },
          { key: 'vce', label: 'Vce', value: '50V' },
        ])
      })

      test('upsertMemo derives props from a property line', async () => {
        // タグは付けない: #zzftbjt を足すと searchItemProps のテストと干渉する。
        const item = await upsertMemo(tid('up1'), '2SC9999\nhFE=123 Vf=700mV')
        expect(item.props).toEqual([
          { key: 'hfe', label: 'hFE', value: '123' },
          { key: 'vf', label: 'Vf', value: '700mV' },
        ])
      })

      test('upsertMemo clears props when the property line is removed', async () => {
        await upsertMemo(tid('up2'), 'hFE=123')
        const item = await upsertMemo(tid('up2'), 'ただの本文')
        expect(item.props).toEqual([])
      })

      test('searchItemProps returns only hits that have props', async () => {
        const { rows } = await searchItemProps('#zzftbjt')
        expect(rows.map((r) => r.itemId).sort()).toEqual([tid('p1'), tid('p2')])
      })

      test('searchItemProps summarizes the memo for the device column', async () => {
        const { rows } = await searchItemProps('#zzftbjt')
        expect(rows.find((r) => r.itemId === tid('p1'))?.summary).toBe('2SC1815')
      })

      test('searchItemProps returns an empty list when nothing has props', async () => {
        expect(await searchItemProps('#zzfttag1')).toEqual({ rows: [], omitted: 0 })
      })

      test('searchItemProps reports nothing omitted when under the limit', async () => {
        expect((await searchItemProps('#zzftbjt')).omitted).toBe(0)
      })
    })

    describe('trash (ゴミ箱)', () => {
      // ゴミ箱のテストは行の状態 (deleted_at) を書き換えるため、上の seed とは
      // 別のノートをテストごとに作る。id は tid() なので afterAll の後始末に乗る。
      const seedNote = (
        itemId: string,
        data: {
          memo?: string
          tags?: string[]
          props?: { key: string; label: string; value: string }[]
          deletedAt?: Date | null
        },
      ) => {
        const values = {
          memo: '',
          url: '',
          mode: 'memo' as const,
          tags: [],
          props: [],
          deletedAt: null,
          ...data,
        }
        return prisma.item.upsert({
          where: { itemId },
          update: values,
          create: { itemId, ...values },
        })
      }

      test('trashed notes drop out of full-text search', async () => {
        await seedNote(tid('del1'), { memo: 'zzftdeltoken ライト' })
        expect(itemIds(await searchItems('zzftdeltoken', 1))).toEqual([tid('del1')])

        await trashItems([tid('del1')])

        expect(itemIds(await searchItems('zzftdeltoken', 1))).toEqual([])
      })

      test('trashed notes drop out of the empty-query browse too', async () => {
        // 一覧ブラウズは実データ込みで返るので、件数の差分で見る
        await seedNote(tid('del2'), { memo: 'zzftbrowsetoken' })
        const before = (await searchItems('', 1)).total

        await trashItems([tid('del2')])

        expect((await searchItems('', 1)).total).toBe(before - 1)
      })

      test('trashed notes drop out of the props table', async () => {
        await seedNote(tid('delp1'), {
          memo: '2SC0001\n#zzftdelbjt\nhFE=100',
          tags: ['zzftdelbjt'],
          props: [{ key: 'hfe', label: 'hFE', value: '100' }],
        })
        expect((await searchItemProps('#zzftdelbjt')).rows.map((r) => r.itemId)).toEqual([
          tid('delp1'),
        ])

        await trashItems([tid('delp1')])

        expect((await searchItemProps('#zzftdelbjt')).rows).toEqual([])
      })

      test('trashed notes drop out of the tag list (補完・集計)', async () => {
        await seedNote(tid('delt1'), { memo: 'zzfttagmemo #zzftdeltag', tags: ['zzftdeltag'] })
        expect((await listTags()).find((t) => t.tag === 'zzftdeltag')?.count).toBe(1)

        await trashItems([tid('delt1')])

        expect((await listTags()).find((t) => t.tag === 'zzftdeltag')).toBeUndefined()
      })

      test('restoreItems brings a note back into search', async () => {
        await seedNote(tid('res1'), { memo: 'zzftrestoretoken' })
        await trashItems([tid('res1')])
        expect(itemIds(await searchItems('zzftrestoretoken', 1))).toEqual([])

        await restoreItems([tid('res1')])

        expect(itemIds(await searchItems('zzftrestoretoken', 1))).toEqual([tid('res1')])
      })

      test('purgeItems deletes only rows that are already in the trash', async () => {
        // 二段階削除の要。通常ノートを渡しても消えてはいけない
        await seedNote(tid('pg1'), { memo: 'zzftpurgetoken', deletedAt: new Date() })
        await seedNote(tid('pg2'), { memo: 'zzftpurgetoken' })

        const purged = await purgeItems([tid('pg1'), tid('pg2')])

        // 戻り値は「実際に消えた itemId」。git の墓石コミットが、消えていない
        // ノートの履歴まで消さないための口 (docs/57-ノートgit履歴計画.md §4)
        expect(purged).toEqual([tid('pg1')])
        expect(await getItem(tid('pg1'))).toBeNull()
        expect(await getItem(tid('pg2'))).not.toBeNull()
      })

      test('getItem still returns a trashed note (/item のバナー用)', async () => {
        await seedNote(tid('get1'), { memo: 'zzftgettoken', deletedAt: new Date() })

        expect((await getItem(tid('get1')))?.deletedAt).toBeInstanceOf(Date)
      })

      test('countTrashedMatches counts trashed hits only, for both text and tag terms', async () => {
        await seedNote(tid('cm1'), { memo: 'zzftcmtoken #zzftcmtag', tags: ['zzftcmtag'] })
        await seedNote(tid('cm2'), {
          memo: 'zzftcmtoken #zzftcmtag',
          tags: ['zzftcmtag'],
          deletedAt: new Date(),
        })

        // 通常ノート (zzftcm1) は数えず、ゴミ箱の 1 件だけ
        expect(await countTrashedMatches('zzftcmtoken')).toBe(1)
        expect(await countTrashedMatches('#zzftcmtag')).toBe(1)
      })

      test('countTrashedMatches honours NOT too (ゴミ箱案内にも否定が効く)', async () => {
        await seedNote(tid('cn1'), {
          memo: 'zzftcntoken #zzftcnkeep',
          tags: ['zzftcnkeep'],
          deletedAt: new Date(),
        })
        await seedNote(tid('cn2'), {
          memo: 'zzftcntoken #zzftcndrop',
          tags: ['zzftcndrop'],
          deletedAt: new Date(),
        })

        // ゴミ箱の 2 件のうち #zzftcndrop の付いた方だけ除外される
        expect(await countTrashedMatches('zzftcntoken')).toBe(2)
        expect(await countTrashedMatches('zzftcntoken !#zzftcndrop')).toBe(1)
      })

      test('listTrashedItems returns newest-deleted first, with the note itself', async () => {
        await seedNote(tid('lt1'), {
          memo: 'ふるいノート\n本文',
          deletedAt: new Date('2026-01-01T00:00:00Z'),
        })
        await seedNote(tid('lt2'), {
          memo: 'あたらしいノート\n本文',
          deletedAt: new Date('2026-02-01T00:00:00Z'),
        })

        const mine = (await listTrashedItems()).filter((r) => r.itemId.startsWith(tidPrefix('lt')))

        expect(mine.map((r) => r.itemId)).toEqual([tid('lt2'), tid('lt1')])
        // 大表示の本文プレビューと画像表示のタイルは本文から作るので、
        // 要約ではなく Item をそのまま返す (docs/67-ゴミ箱表示形式計画.md §2)
        expect(mine[0]?.memo).toBe('あたらしいノート\n本文')
      })

      // ゴミ箱にも並び順が効く (docs/67-ゴミ箱表示形式計画.md §2)。
      // id (登録順) は 1 が先、削除日時は 1 が新しい方 — こうしておくと 3 つの並びが
      // それぞれ別の結果になり、指定が本当に SQL まで届いているか判る
      test('listTrashedItems sorts by the given order', async () => {
        await seedNote(tid('ls1'), {
          memo: 'ゴミ箱の並び 1',
          deletedAt: new Date('2026-02-01T00:00:00Z'),
        })
        await seedNote(tid('ls2'), {
          memo: 'ゴミ箱の並び 2',
          deletedAt: new Date('2026-01-01T00:00:00Z'),
        })

        const mineOf = async (sort: Parameters<typeof listTrashedItems>[0]) =>
          (await listTrashedItems(sort))
            .filter((r) => r.itemId.startsWith(tidPrefix('ls')))
            .map((r) => r.itemId)

        expect(await mineOf('deleted')).toEqual([tid('ls1'), tid('ls2')])
        expect(await mineOf('deletedAsc')).toEqual([tid('ls2'), tid('ls1')])
        // 検索一覧と同じ種別も使える (登録順は id 昇順)
        expect(await mineOf('registered')).toEqual([tid('ls1'), tid('ls2')])
        expect(await mineOf('registeredDesc')).toEqual([tid('ls2'), tid('ls1')])
      })

      test('countTrashedItems counts the trash', async () => {
        const before = await countTrashedItems()

        await seedNote(tid('ct1'), { memo: 'zzftcounttoken', deletedAt: new Date() })

        expect(await countTrashedItems()).toBe(before + 1)
      })
    })

    // --- 公開 (docs/22-ノート公開計画.md) ---
    describe('公開 (setItemPublic / isPublicImageName)', () => {
      // 他の describe の seed を汚さないよう、この節で使うノートを都度作る。
      // id は tid() なので afterAll の後始末に乗る
      async function makeNote(
        suffix: string,
        data: { memo?: string; publicAt?: Date | null; deletedAt?: Date | null } = {},
      ): Promise<string> {
        const itemId = tid(`pb${suffix}`)
        await prisma.item.upsert({
          where: { itemId },
          update: { memo: '', publicAt: null, deletedAt: null, ...data },
          create: { itemId, memo: '', ...data },
        })
        return itemId
      }

      test('公開すると public_at が入り、やめると null に戻る', async () => {
        const itemId = await makeNote('tg')

        await setItemPublic(itemId, true)
        expect((await getItem(itemId))?.publicAt).toBeInstanceOf(Date)

        await setItemPublic(itemId, false)
        expect((await getItem(itemId))?.publicAt).toBeNull()
      })

      // 押し直すたびに公開日時が今へ進むのは嘘 (docs/22 §7)。
      // WHERE public_at IS NULL がそれを止めている
      test('公開中のノートへもう一度公開しても public_at を上書きしない', async () => {
        const itemId = await makeNote('ag')

        await setItemPublic(itemId, true)
        const first = (await getItem(itemId))?.publicAt

        const affected = await setItemPublic(itemId, true)

        expect(affected).toBe(0)
        expect((await getItem(itemId))?.publicAt).toEqual(first)
      })

      // 本文は変わっていないのに更新順が動くのは嘘 (trashItems と同じ理由)。
      // Prisma の update は @updatedAt を必ず打つので生 SQL で書いてある
      test('公開の切り替えは updated_at を触らない', async () => {
        const itemId = await makeNote('to')
        const before = (await getItem(itemId))?.updatedAt

        await setItemPublic(itemId, true)

        expect((await getItem(itemId))?.updatedAt).toEqual(before)
      })

      test('公開ノートに貼った画像の名前は公開と判定する', async () => {
        const name = '0191f0c4-6f3b-7a1e-9c2d-4b5a6c7d8e9f.png'
        await makeNote('im', {
          memo: `写真 ![](/api/images/${name})`,
          publicAt: new Date(),
        })

        expect(await isPublicImageName(name)).toBe(true)
      })

      test('非公開ノートに貼った画像の名前は公開しない', async () => {
        const name = '0191f0c4-6f3b-7a1e-9c2d-4b5a6c7d8e01.png'
        await makeNote('ip', { memo: `![](/api/images/${name})` })

        expect(await isPublicImageName(name)).toBe(false)
      })

      // isPublicItem() と同じ規則 (docs/22 §3)
      test('ゴミ箱の公開ノートに貼った画像は公開しない', async () => {
        const name = '0191f0c4-6f3b-7a1e-9c2d-4b5a6c7d8e02.png'
        await makeNote('it', {
          memo: `![](/api/images/${name})`,
          publicAt: new Date(),
          deletedAt: new Date(),
        })

        expect(await isPublicImageName(name)).toBe(false)
      })

      test('どのノートにも貼られていない画像は公開しない', async () => {
        expect(
          await isPublicImageName('0191f0c4-6f3b-7a1e-9c2d-4b5a6c7d8e03.png'),
        ).toBe(false)
      })

      // この DB では PGroonga が LIKE を乗っ取るため、部分一致は position() で
      // 判定している。LIKE に戻すと全文検索の正規化 (全半角・大小) が効いて
      // しまい、別名の画像まで一致しうる
      test('部分一致は全文検索の正規化に引きずられない (position を使っている)', async () => {
        const name = '0191f0c4-6f3b-7a1e-9c2d-4b5a6c7d8e04.png'
        // 大文字違いの名前を本文に持つ公開ノート。position() は素の
        // バイト比較なので一致しない
        await makeNote('ic', {
          memo: `![](/api/images/${name.toUpperCase()})`,
          publicAt: new Date(),
        })

        expect(await isPublicImageName(name)).toBe(false)
      })
    })

    // 編集の競合 (docs/87-編集競合対策計画.md §2-4, §2-5)。
    // 「基点が同じなら書く」条件付き UPDATE と、その上に載る 1 行書き換え。
    describe('saveItemIfUnchanged / modifyMemo (競合)', () => {
      const casNote = async (itemId: string, memo: string) => {
        await prisma.item.deleteMany({ where: { itemId } })
        return prisma.item.create({
          data: { itemId, memo, url: '', mode: 'memo' },
        })
      }

      test('基点が合えば書ける。版 (updated_at) は必ず前へ進む', async () => {
        // Arrange
        const before = await casNote(tid('cas1'), 'v1')

        // Act — 続けて 2 回保存する (同じミリ秒に入りうる)
        const first = await saveItemIfUnchanged(
          tid('cas1'),
          { memo: 'v2' },
          { kind: 'at', at: before.updatedAt },
        )
        expect(first.ok).toBe(true)
        const firstAt = first.ok ? first.item.updatedAt : before.updatedAt
        const second = await saveItemIfUnchanged(
          tid('cas1'),
          { memo: 'v3' },
          { kind: 'at', at: firstAt },
        )

        // Assert
        expect(second.ok).toBe(true)
        expect(firstAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
        if (second.ok) {
          expect(second.item.updatedAt.getTime()).toBeGreaterThan(firstAt.getTime())
          expect(second.item.memo).toBe('v3')
        }
      })

      test('派生列も作り直す (保存経路が 1 つに揃っている)', async () => {
        const before = await casNote(tid('cas2'), '')

        const result = await saveItemIfUnchanged(
          tid('cas2'),
          { memo: '見出し\n#zzftcastag\nhFE=208\n- [ ] やること' },
          { kind: 'at', at: before.updatedAt },
        )

        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.item.title).toBe('見出し')
          expect(result.item.tags).toContain('zzftcastag')
          expect(result.item.taskTodo).toBe(1)
        }
      })

      test('先に別の端末が保存していたら書かずに competing 版を返す', async () => {
        // Arrange — 画面が開いた時点の基点
        const opened = await casNote(tid('cas3'), 'v1')
        // 別の端末が先に保存した
        await saveItemIfUnchanged(
          tid('cas3'),
          { memo: '相手の版' },
          { kind: 'at', at: opened.updatedAt },
        )

        // Act — 古い基点のまま保存する
        const result = await saveItemIfUnchanged(
          tid('cas3'),
          { memo: '自分の版' },
          { kind: 'at', at: opened.updatedAt },
        )

        // Assert — 上書きせず、いまの版を返す
        expect(result.ok).toBe(false)
        if (!result.ok && result.reason === 'conflict') {
          expect(result.current.memo).toBe('相手の版')
        } else {
          expect.unreachable('conflict を返すこと')
        }
        expect((await getItem(tid('cas3')))?.memo).toBe('相手の版')
      })

      test('同じ内容の二重送信は成功扱い (版も動かさない)', async () => {
        const before = await casNote(tid('cas4'), 'v1')
        const first = await saveItemIfUnchanged(
          tid('cas4'),
          { memo: '同じ本文' },
          { kind: 'at', at: before.updatedAt },
        )
        expect(first.ok).toBe(true)
        const savedAt = first.ok ? first.item.updatedAt : before.updatedAt

        // Act — 同じ本文を古い基点でもう一度 (二重送信・別タブの取り違え)
        const again = await saveItemIfUnchanged(
          tid('cas4'),
          { memo: '同じ本文' },
          { kind: 'at', at: before.updatedAt },
        )

        // Assert
        expect(again.ok).toBe(true)
        if (again.ok) {
          expect(again.item.updatedAt.getTime()).toBe(savedAt.getTime())
        }
      })

      test('行末だけが違う本文は「変わっていない」と見なす (Ver1 由来の CRLF)', async () => {
        await casNote(tid('cas5'), 'a\r\nb')
        const stored = await getItem(tid('cas5'))

        const result = await saveItemIfUnchanged(
          tid('cas5'),
          { memo: 'a\nb' },
          { kind: 'at', at: new Date((stored?.updatedAt.getTime() ?? 0) - 1000) },
        )

        expect(result.ok).toBe(true)
      })

      test('基点不明 (stale) は必ず競合にする', async () => {
        await casNote(tid('cas6'), 'v1')

        const result = await saveItemIfUnchanged(tid('cas6'), { memo: 'v2' }, { kind: 'stale' })

        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.reason).toBe('conflict')
        expect((await getItem(tid('cas6')))?.memo).toBe('v1')
      })

      test('新規のつもりで既存番号なら exists (先に作られていた)', async () => {
        await casNote(tid('cas7'), '先に作られた本文')

        const result = await saveItemIfUnchanged(tid('cas7'), { memo: '後から' }, { kind: 'new' })

        expect(result.ok).toBe(false)
        if (!result.ok && result.reason === 'exists') {
          expect(result.current.memo).toBe('先に作られた本文')
        } else {
          expect.unreachable('exists を返すこと')
        }
      })

      test('新規なら作る (派生列も入る)', async () => {
        await prisma.item.deleteMany({ where: { itemId: tid('cas8') } })

        const result = await saveItemIfUnchanged(
          tid('cas8'),
          { memo: '新しいノート #zzftcasnew', url: '', mode: 'memo' },
          { kind: 'new' },
        )

        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.item.itemId).toBe(tid('cas8'))
          expect(result.item.tags).toContain('zzftcasnew')
        }
      })

      test('編集中に永久削除されたら missing (黙って作り直さない)', async () => {
        const before = await casNote(tid('cas9'), 'v1')
        await prisma.item.deleteMany({ where: { itemId: tid('cas9') } })

        const result = await saveItemIfUnchanged(
          tid('cas9'),
          { memo: 'v2' },
          { kind: 'at', at: before.updatedAt },
        )

        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.reason).toBe('missing')
        expect(await getItem(tid('cas9'))).toBeNull()
      })

      test('url / mode も一緒に書ける', async () => {
        const before = await casNote(tid('cas10'), 'v1')

        const result = await saveItemIfUnchanged(
          tid('cas10'),
          { memo: 'v2', url: 'https://example.com/zzftcas', mode: 'url' },
          { kind: 'at', at: before.updatedAt },
        )

        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.item.url).toBe('https://example.com/zzftcas')
          expect(result.item.mode).toBe('url')
        }
      })

      test('同時に押した 2 つのチェックは両方とも残る (再読込して再適用)', async () => {
        // Arrange — 別々の行のチェック
        await casNote(tid('mod1'), ['- [ ] 学習済み', '- [ ] 自信あり'].join('\n'))

        // Act — 2 つの切り替えを同時に投げる
        const [a, b] = await Promise.all([
          modifyMemo(tid('mod1'), (memo) => toggleTaskLine(memo, 1, true), {
            canRetry: differsOnlyInTaskMarks,
          }),
          modifyMemo(tid('mod1'), (memo) => toggleTaskLine(memo, 2, true), {
            canRetry: differsOnlyInTaskMarks,
          }),
        ])

        // Assert — 後から書いた側が前の分を消していない
        expect([a, b]).toEqual(['saved', 'saved'])
        expect((await getItem(tid('mod1')))?.memo).toBe(
          ['- [x] 学習済み', '- [x] 自信あり'].join('\n'),
        )
      })

      test('再適用してよいかは呼び手が決める (行が増えていたら諦める)', async () => {
        // Arrange
        await casNote(tid('mod2'), '- [ ] 学習済み')
        let reads = 0

        // Act — 1 回目の「読んでから書くまで」に、行が増える保存を割り込ませる。
        // CAS が必ず負け、2 周目は行番号がずれた本文を読むことになる
        const result = await modifyMemo(
          tid('mod2'),
          async (memo) => {
            reads += 1
            if (reads === 1) {
              await prisma.item.update({
                where: { itemId: tid('mod2') },
                data: { memo: ['新しい見出し', '- [ ] 学習済み'].join('\n') },
              })
            }
            return toggleTaskLine(memo, 1, true)
          },
          { canRetry: differsOnlyInTaskMarks },
        )

        // Assert — ずれた行番号で別の項目を裏返さない
        expect(result).toBe('rejected')
        expect((await getItem(tid('mod2')))?.memo).toBe(
          ['新しい見出し', '- [ ] 学習済み'].join('\n'),
        )
      })

      test('再適用の門番が無ければ、読み直して素直に再適用する', async () => {
        // Arrange — 本文で位置が決まる書き換え (タグ追加) は行番号に依らない
        await casNote(tid('mod6'), '本文')
        let reads = 0

        // Act
        const result = await modifyMemo(tid('mod6'), async (memo) => {
          reads += 1
          if (reads === 1) {
            await prisma.item.update({
              where: { itemId: tid('mod6') },
              data: { memo: '本文 (別の端末が直した)' },
            })
          }
          return `${memo} #zzftmodtag`
        })

        // Assert — 割り込んだ側の本文の上に載る (消さない)
        expect(result).toBe('saved')
        expect((await getItem(tid('mod6')))?.memo).toBe('本文 (別の端末が直した) #zzftmodtag')
      })

      test('その行がタスクでなければ rejected (本文が変わっている印)', async () => {
        await casNote(tid('mod3'), 'ただの本文')

        const result = await modifyMemo(tid('mod3'), (memo) => toggleTaskLine(memo, 1, true))

        expect(result).toBe('rejected')
      })

      test('既に望む状態なら書かない (版を動かさない)', async () => {
        const before = await casNote(tid('mod4'), '- [x] 学習済み')

        const result = await modifyMemo(tid('mod4'), (memo) => toggleTaskLine(memo, 1, true))

        expect(result).toBe('unchanged')
        expect((await getItem(tid('mod4')))?.updatedAt.getTime()).toBe(
          before.updatedAt.getTime(),
        )
      })

      test('ノートが無ければ missing (作らない)', async () => {
        await prisma.item.deleteMany({ where: { itemId: tid('mod5') } })

        expect(await modifyMemo(tid('mod5'), (memo) => `${memo}追記`)).toBe('missing')
        expect(await getItem(tid('mod5'))).toBeNull()
      })
    })
  },
)
