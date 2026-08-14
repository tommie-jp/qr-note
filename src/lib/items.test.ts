import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type {
  countTaskProgress as CountTaskProgressFn,
  countTrashedItems as CountTrashedItemsFn,
  countTrashedMatches as CountTrashedMatchesFn,
  findListNeighbors as FindListNeighborsFn,
  getItem as GetItemFn,
  isPublicImageName as IsPublicImageNameFn,
  listTags as ListTagsFn,
  listTrashedItems as ListTrashedItemsFn,
  nextItemNo as NextItemNoFn,
  purgeItems as PurgeItemsFn,
  restoreItems as RestoreItemsFn,
  searchItemChecks as SearchItemChecksFn,
  searchItemProps as SearchItemPropsFn,
  searchItems as SearchItemsFn,
  setItemPublic as SetItemPublicFn,
  trashItems as TrashItemsFn,
  upsertMemo as UpsertMemoFn,
} from './items'
import type { PrismaClient } from '@/generated/prisma/client'

// DB を実際に叩く統合テスト。
// 通常の `npm test` (および doDeploy の lint+test) では走らせず、
// DATABASE_URL があり かつ RUN_DB_TESTS=1 のときだけ実行する。
// db.ts はモジュール読み込み時に DATABASE_URL を要求するため、
// import は beforeAll 内で動的に行い、skip 時に評価されないようにする。
const runDbTests =
  !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === '1'

// 実データと衝突しないよう itemNo は "zzft" プレフィックスで統一し、後始末で消す。
const TEST_PREFIX = 'zzft'

describe.skipIf(!runDbTests)(
  'searchItems (integration; needs DATABASE_URL + RUN_DB_TESTS=1)',
  () => {
    let searchItems: typeof SearchItemsFn
    let searchItemProps: typeof SearchItemPropsFn
    let searchItemChecks: typeof SearchItemChecksFn
    let upsertMemo: typeof UpsertMemoFn
    let listTags: typeof ListTagsFn
    let getItem: typeof GetItemFn
    let trashItems: typeof TrashItemsFn
    let restoreItems: typeof RestoreItemsFn
    let purgeItems: typeof PurgeItemsFn
    let listTrashedItems: typeof ListTrashedItemsFn
    let countTrashedItems: typeof CountTrashedItemsFn
    let countTrashedMatches: typeof CountTrashedMatchesFn
    let countTaskProgress: typeof CountTaskProgressFn
    let findListNeighbors: typeof FindListNeighborsFn
    let nextItemNo: typeof NextItemNoFn
    let setItemPublic: typeof SetItemPublicFn
    let isPublicImageName: typeof IsPublicImageNameFn
    let prisma: PrismaClient

    const seed = [
      { itemNo: 'zzfta1', memo: 'zzfttoken zzftonlya1 ライト RITEX', url: '', mode: 'memo' as const },
      { itemNo: 'zzfta2', memo: 'zzfttoken ライト', url: '', mode: 'memo' as const },
      { itemNo: 'zzfta3', memo: 'zzfttoken ２ＳＣ１８１５', url: '', mode: 'memo' as const },
      {
        itemNo: 'zzfta4',
        memo: '',
        url: 'https://example.com/zzfturltoken',
        mode: 'url' as const,
      },
      {
        itemNo: 'zzftt1',
        memo: 'zzfttagmemo #zzfttag1 #zzftshared',
        url: '',
        mode: 'memo' as const,
        tags: ['zzfttag1', 'zzftshared'],
      },
      {
        itemNo: 'zzftt2',
        memo: 'zzfttagmemo #zzfttag2 #zzftshared',
        url: '',
        mode: 'memo' as const,
        tags: ['zzfttag2', 'zzftshared'],
      },
      // 特性表用: 同じタグを共有し、片方だけ余分な列 (Vce) を持つ。
      {
        itemNo: 'zzftp1',
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
        itemNo: 'zzftp2',
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
        itemNo: 'zzftp3',
        memo: 'プロパティのないノート\n#zzftbjt',
        url: '',
        mode: 'memo' as const,
        tags: ['zzftbjt'],
      },
      // チェック状態の絞り込み用 (docs/56-チェック検索計画.md)。
      // 派生列は upsertMemo が数えるので、ここでは seed に直接書く。
      {
        itemNo: 'zzftk1',
        memo: 'zzftcheck\n- [ ] まだ',
        url: '',
        mode: 'memo' as const,
        taskTodo: 1,
        taskDone: 0,
      },
      {
        itemNo: 'zzftk2',
        memo: 'zzftcheck\n- [x] おわり',
        url: '',
        mode: 'memo' as const,
        taskTodo: 0,
        taskDone: 1,
      },
      {
        itemNo: 'zzftk3',
        memo: 'zzftcheck\n- [ ] まだ\n- [x] おわり',
        url: '',
        mode: 'memo' as const,
        taskTodo: 1,
        taskDone: 1,
      },
      // チェックのないノート (どちらにも出ない)
      {
        itemNo: 'zzftk4',
        memo: 'zzftcheck チェックなし',
        url: '',
        mode: 'memo' as const,
      },
      // 学習進捗と前後ナビ用 (docs/60-学習進捗計画.md)。チェック 2 つで
      // 未着手 / 自信なし / 習得済み の 3 状態を作る。
      // zzftcheck 系とは別トークンにする — あちらは後続のテストが
      // zzftcheck2 のノートを足すため、部分一致で巻き込まれる
      {
        itemNo: 'zzftn1',
        memo: 'zzftnav 問1\n- [ ] 学習済み\n- [ ] 自信あり',
        url: '',
        mode: 'memo' as const,
        taskTodo: 2,
        taskDone: 0,
      },
      {
        itemNo: 'zzftn2',
        memo: 'zzftnav 問2\n- [x] 学習済み\n- [ ] 自信あり',
        url: '',
        mode: 'memo' as const,
        taskTodo: 1,
        taskDone: 1,
      },
      {
        itemNo: 'zzftn3',
        memo: 'zzftnav 問3\n- [x] 学習済み\n- [x] 自信あり',
        url: '',
        mode: 'memo' as const,
        taskTodo: 0,
        taskDone: 2,
      },
      // チェックを持たないので進捗の母数に入らない
      {
        itemNo: 'zzftn4',
        memo: 'zzftnav 問4 チェックなし',
        url: '',
        mode: 'memo' as const,
      },
    ]

    beforeAll(async () => {
      ;({
        searchItems,
        searchItemProps,
        searchItemChecks,
        upsertMemo,
        listTags,
        getItem,
        trashItems,
        restoreItems,
        purgeItems,
        listTrashedItems,
        countTrashedItems,
        countTrashedMatches,
        countTaskProgress,
        findListNeighbors,
        nextItemNo,
        setItemPublic,
        isPublicImageName,
      } = await import('./items'))
      ;({ prisma } = await import('./db'))
      await prisma.item.deleteMany({ where: { itemNo: { startsWith: TEST_PREFIX } } })
      for (const s of seed) {
        await prisma.item.create({ data: { itemNoNum: null, ...s } })
      }
    })

    afterAll(async () => {
      if (!prisma) return
      await prisma.item.deleteMany({ where: { itemNo: { startsWith: TEST_PREFIX } } })
      await prisma.$disconnect()
    })

    const itemNos = (r: { items: { itemNo: string }[] }) =>
      r.items.map((i) => i.itemNo).sort()

    test('matches memo content across rows sharing a token (全文検索)', async () => {
      const r = await searchItems('zzfttoken', 1)
      expect(itemNos(r)).toEqual(['zzfta1', 'zzfta2', 'zzfta3'])
    })

    test('AND-searches space-separated terms (両方を含む行だけ)', async () => {
      const r = await searchItems('zzfttoken RITEX', 1)
      expect(itemNos(r)).toEqual(['zzfta1'])
    })

    // OR は seed 専用トークンだけで検証する (実データと衝突させない)。
    test('OR-searches with the OR keyword (どちらかを含む行)', async () => {
      const r = await searchItems('zzftonlya1 OR zzfturltoken', 1)
      expect(itemNos(r)).toEqual(['zzfta1', 'zzfta4'])
    })

    test('OR-searches with the pipe operator', async () => {
      const r = await searchItems('zzftonlya1|zzfturltoken', 1)
      expect(itemNos(r)).toEqual(['zzfta1', 'zzfta4'])
    })

    test('OR-searches with full-width operators (｜ / ＯＲ)', async () => {
      // 日本語入力の全角モードのまま打っても半角と同じに効く
      expect(itemNos(await searchItems('zzftonlya1｜zzfturltoken', 1))).toEqual([
        'zzfta1',
        'zzfta4',
      ])
      expect(itemNos(await searchItems('zzftonlya1 ＯＲ zzfturltoken', 1))).toEqual([
        'zzfta1',
        'zzfta4',
      ])
    })

    test('space binds tighter than OR (AND-group OR term)', async () => {
      // (zzfttoken AND zzftonlya1) OR zzfturltoken
      const r = await searchItems('zzfttoken zzftonlya1 OR zzfturltoken', 1)
      expect(itemNos(r)).toEqual(['zzfta1', 'zzfta4'])
    })

    // NOT / 括弧も seed 専用トークンとの AND で挟んで検証する。裸の否定は
    // 「それ以外すべて」になり実データを巻き込むため。
    describe('NOT and parentheses', () => {
      test('! excludes rows matching the negated term', async () => {
        const r = await searchItems('zzfttoken !RITEX', 1)
        expect(itemNos(r)).toEqual(['zzfta2', 'zzfta3'])
      })

      test('! negates a parenthesized OR group', async () => {
        const r = await searchItems('zzfttoken !(RITEX OR 2sc1815)', 1)
        expect(itemNos(r)).toEqual(['zzfta2'])
      })

      test('parentheses group an OR so the AND applies to the whole group', async () => {
        const r = await searchItems('zzfttoken (RITEX OR 2sc1815)', 1)
        expect(itemNos(r)).toEqual(['zzfta1', 'zzfta3'])
      })

      test('! excludes a tag', async () => {
        const r = await searchItems('#zzftshared !#zzfttag1', 1)
        expect(itemNos(r)).toEqual(['zzftt2'])
      })

      test('! applies to one operand only, not the whole AND-group', async () => {
        // zzfttoken AND NOT(RITEX) — zzfttoken 自体は否定されない
        const r = await searchItems('!RITEX zzfttoken', 1)
        expect(itemNos(r)).toEqual(['zzfta2', 'zzfta3'])
      })

      test('a dangling ! is ignored (寛容パース)', async () => {
        const r = await searchItems('zzfttoken !', 1)
        expect(itemNos(r)).toEqual(['zzfta1', 'zzfta2', 'zzfta3'])
      })

      test('an unclosed ( is auto-closed (寛容パース)', async () => {
        const r = await searchItems('zzfttoken (RITEX OR 2sc1815', 1)
        expect(itemNos(r)).toEqual(['zzfta1', 'zzfta3'])
      })

      test('the props table honours a negated tag', async () => {
        const { rows } = await searchItemProps('#zzftbjt !2SC1815')
        expect(rows.map((r) => r.itemNo)).toEqual(['zzftp2'])
      })
    })

    test('AND-searches with a full-width space too', async () => {
      const r = await searchItems('ライト　zzfttoken', 1)
      expect(itemNos(r)).toEqual(['zzfta1', 'zzfta2'])
    })

    test('normalizes full/half width and case (２ＳＣ→2sc)', async () => {
      const r = await searchItems('zzfttoken 2sc1815', 1)
      expect(itemNos(r)).toEqual(['zzfta3'])
    })

    test('matches URL content', async () => {
      const r = await searchItems('zzfturltoken', 1)
      expect(itemNos(r)).toEqual(['zzfta4'])
    })

    test('keeps itemNo prefix search (前方一致)', async () => {
      const r = await searchItems('zzfta', 1)
      expect(itemNos(r)).toEqual(['zzfta1', 'zzfta2', 'zzfta3', 'zzfta4'])
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
        expect(itemNos(r)).toEqual(['zzftk1', 'zzftk3'])
      })

      test('is:done はチェック済みがあるノートだけ', async () => {
        const r = await searchItems('zzftcheck is:done', 1)
        expect(itemNos(r)).toEqual(['zzftk2', 'zzftk3'])
      })

      test('!is:todo は未チェックが残っていないノート (チェック無しも含む)', async () => {
        const r = await searchItems('zzftcheck !is:todo', 1)
        expect(itemNos(r)).toEqual(['zzftk2', 'zzftk4'])
      })

      test('全部覚えたノートは !is:todo is:done で引ける', async () => {
        const r = await searchItems('zzftcheck !is:todo is:done', 1)
        expect(itemNos(r)).toEqual(['zzftk2'])
      })

      test('引用すればリテラルの全文検索に戻る', async () => {
        // seed 語で必ず絞る。裸の `"is:todo"` だと、本文に is:todo と書いた
        // 実ノート (この機能のメモなど) ができた日に落ちる
        const r = await searchItems('zzftcheck "is:todo"', 1)
        expect(itemNos(r)).toEqual([])
      })

      // タグの無いノートの絞り込み (docs/86 §5 未分類フォルダー)
      test('is:untagged はタグの無いノートだけ', async () => {
        const r = await searchItems('zzfttoken is:untagged', 1)
        expect(itemNos(r)).toEqual(['zzfta1', 'zzfta2', 'zzfta3'])
      })

      test('!is:untagged はタグのあるノートだけ', async () => {
        const r = await searchItems('zzfttagmemo !is:untagged', 1)
        expect(itemNos(r)).toEqual(['zzftt1', 'zzftt2'])
        const none = await searchItems('zzfttagmemo is:untagged', 1)
        expect(itemNos(none)).toEqual([])
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
          expect(rows.map((r) => r.itemNo).sort()).toEqual([
            'zzftn1',
            'zzftn2',
            'zzftn3',
          ])
        })

        test('チェック数を本文と一緒に返す (表の 3 状態の元になる)', async () => {
          const { rows } = await searchItemChecks('zzftnav')
          const byNo = new Map(rows.map((r) => [r.itemNo, r]))
          expect(byNo.get('zzftn1')).toMatchObject({ taskTodo: 2, taskDone: 0 })
          expect(byNo.get('zzftn2')).toMatchObject({ taskTodo: 1, taskDone: 1 })
          expect(byNo.get('zzftn3')).toMatchObject({ taskTodo: 0, taskDone: 2 })
          expect(byNo.get('zzftn1')?.memo).toContain('学習済み')
        })

        // 既定が番号順なのは、表から開いて前後ナビで順に回すため
        // (docs/60-学習進捗計画.md §4)。更新順だとチェックを押した瞬間に
        // ノートが先頭へ移り、前後が狂う
        test('既定は番号順で返る', async () => {
          const { rows } = await searchItemChecks('zzftnav')
          expect(rows.map((r) => r.itemNo)).toEqual([
            'zzftn1',
            'zzftn2',
            'zzftn3',
          ])
        })

        test('検索式で絞れる', async () => {
          const { rows } = await searchItemChecks('zzftnav !is:todo')
          expect(rows.map((r) => r.itemNo)).toEqual(['zzftn3'])
        })

        test('ゴミ箱のノートは入らない', async () => {
          await trashItems(['zzftn1'])
          try {
            const { rows } = await searchItemChecks('zzftnav')
            expect(rows.map((r) => r.itemNo)).not.toContain('zzftn1')
          } finally {
            await restoreItems(['zzftn1'])
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
      // seed は itemNoNum が null なので、itemNo 順 = item_no の辞書順で安定する
      describe('findListNeighbors', () => {
        test('一覧の並びで前後を返す', async () => {
          expect(await findListNeighbors('zzftnav', 'itemNo', 'zzftn2')).toEqual({
            prev: 'zzftn1',
            next: 'zzftn3',
          })
        })

        test('端では行き先が null になる', async () => {
          expect(await findListNeighbors('zzftnav', 'itemNo', 'zzftn1')).toEqual({
            prev: null,
            next: 'zzftn2',
          })
          expect(await findListNeighbors('zzftnav', 'itemNo', 'zzftn4')).toEqual({
            prev: 'zzftn3',
            next: null,
          })
        })

        test('絞り込みに合うものだけを辿る (学習済みを飛ばす)', async () => {
          // is:todo に残るのは zzftn1 (未着手) と zzftn2 (自信なし)。
          // 習得済みの zzftn3 とチェック無しの zzftn4 は飛ばす
          expect(
            await findListNeighbors('zzftnav is:todo', 'itemNo', 'zzftn1'),
          ).toEqual({ prev: null, next: 'zzftn2' })
        })

        // ここが要 (docs/60 §4)。チェックを付けた直後は自分が一覧から消えるが、
        // それでも「次」は正しく次のノートを指さなければならない
        test('自分が絞り込みから外れていても前後は求まる', async () => {
          expect(
            await findListNeighbors('zzftnav is:todo', 'itemNo', 'zzftn3'),
          ).toEqual({ prev: 'zzftn2', next: null })
        })

        test('未登録の itemNo では前後とも null (ナビを出さない)', async () => {
          expect(
            await findListNeighbors('zzftnav', 'itemNo', 'zzftnope'),
          ).toEqual({ prev: null, next: null })
        })

        test('ゴミ箱のノートは辿らない', async () => {
          await trashItems(['zzftn2'])
          try {
            expect(
              await findListNeighbors('zzftnav', 'itemNo', 'zzftn1'),
            ).toEqual({ prev: null, next: 'zzftn3' })
          } finally {
            await restoreItems(['zzftn2'])
          }
        })
      })

      test('保存するとチェック数が追随する (派生キャッシュ)', async () => {
        await upsertMemo('zzftk5', 'zzftcheck2\n- [ ] まだ')
        expect(itemNos(await searchItems('zzftcheck2 is:todo', 1))).toEqual([
          'zzftk5',
        ])
        await upsertMemo('zzftk5', 'zzftcheck2\n- [x] おわり')
        expect(itemNos(await searchItems('zzftcheck2 is:todo', 1))).toEqual([])
        expect(itemNos(await searchItems('zzftcheck2 is:done', 1))).toEqual([
          'zzftk5',
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
          const itemNo = `zzftpn${String(i).padStart(2, '0')}`
          await prisma.item.upsert({
            where: { itemNo },
            update: { memo: TOKEN },
            create: { itemNo, itemNoNum: null, memo: TOKEN },
          })
        }
        // 全行を同じ updated_at にする。同時刻でも並びが揺れないこと
        // (タイブレーク) を検証するため
        await prisma.$executeRaw`
          UPDATE items SET updated_at = '2026-03-01T00:00:00Z'
          WHERE item_no LIKE 'zzftpn%'
        `
      })

      test('page 2 returns pages 1..2 cumulatively (先頭 20 件は page 1 と同一)', async () => {
        const p1 = await searchItems(TOKEN, 1)
        expect(p1.items).toHaveLength(20)
        expect(p1.total).toBe(NOTES)
        expect(p1.pageCount).toBe(2)

        const p2 = await searchItems(TOKEN, 2)
        expect(p2.items).toHaveLength(NOTES)
        expect(p2.items.slice(0, 20).map((i) => i.itemNo)).toEqual(
          p1.items.map((i) => i.itemNo),
        )
      })

      test('equal updated_at rows keep a stable order (item_no でタイブレーク)', async () => {
        const r = await searchItems(TOKEN, 2)
        const nos = r.items.map((i) => i.itemNo)
        expect(nos).toEqual([...nos].sort())
      })
    })

    describe('tag search', () => {
      test('#tag matches items carrying that tag', async () => {
        const r = await searchItems('#zzfttag1', 1)
        expect(itemNos(r)).toEqual(['zzftt1'])
      })

      test('a shared tag matches every item that has it', async () => {
        const r = await searchItems('#zzftshared', 1)
        expect(itemNos(r)).toEqual(['zzftt1', 'zzftt2'])
      })

      test('AND of two tags matches only items with both', async () => {
        const r = await searchItems('#zzftshared #zzfttag1', 1)
        expect(itemNos(r)).toEqual(['zzftt1'])
      })

      test('OR of two tags matches either', async () => {
        const r = await searchItems('#zzfttag1 OR #zzfttag2', 1)
        expect(itemNos(r)).toEqual(['zzftt1', 'zzftt2'])
      })

      test('tag search is exact, not substring of memo text', async () => {
        // zzfttagmemo は本文に含まれるがタグではないのでヒットしない
        const r = await searchItems('#zzfttagmemo', 1)
        expect(itemNos(r)).toEqual([])
      })

      test('a quoted "#tag" falls back to full-text (finds the literal in memo)', async () => {
        const r = await searchItems('"#zzfttag1"', 1)
        expect(itemNos(r)).toEqual(['zzftt1'])
      })
    })

    describe('props', () => {
      test('searchItems projects the props column onto the item', async () => {
        // 生 SQL の SELECT に props を足し忘れると undefined になる (型では気づけない)。
        const r = await searchItems('#zzftbjt', 1)
        const item = r.items.find((i) => i.itemNo === 'zzftp2')
        expect(item?.props).toEqual([
          { key: 'hfe', label: 'hFE', value: '208' },
          { key: 'vce', label: 'Vce', value: '50V' },
        ])
      })

      test('upsertMemo derives props from a property line', async () => {
        // タグは付けない: #zzftbjt を足すと searchItemProps のテストと干渉する。
        const item = await upsertMemo('zzftup1', '2SC9999\nhFE=123 Vf=700mV')
        expect(item.props).toEqual([
          { key: 'hfe', label: 'hFE', value: '123' },
          { key: 'vf', label: 'Vf', value: '700mV' },
        ])
      })

      test('upsertMemo clears props when the property line is removed', async () => {
        await upsertMemo('zzftup2', 'hFE=123')
        const item = await upsertMemo('zzftup2', 'ただの本文')
        expect(item.props).toEqual([])
      })

      test('searchItemProps returns only hits that have props', async () => {
        const { rows } = await searchItemProps('#zzftbjt')
        expect(rows.map((r) => r.itemNo).sort()).toEqual(['zzftp1', 'zzftp2'])
      })

      test('searchItemProps summarizes the memo for the device column', async () => {
        const { rows } = await searchItemProps('#zzftbjt')
        expect(rows.find((r) => r.itemNo === 'zzftp1')?.summary).toBe('2SC1815')
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
      // 別のノートをテストごとに作る。zzft プレフィックスなので afterAll の
      // 後始末に乗る (数値 itemNo を使う採番のテストだけは例外。下記)。
      const seedNote = (
        itemNo: string,
        data: {
          memo?: string
          tags?: string[]
          props?: { key: string; label: string; value: string }[]
          deletedAt?: Date | null
        },
      ) => {
        const values = {
          itemNoNum: null,
          memo: '',
          url: '',
          mode: 'memo' as const,
          tags: [],
          props: [],
          deletedAt: null,
          ...data,
        }
        return prisma.item.upsert({
          where: { itemNo },
          update: values,
          create: { itemNo, ...values },
        })
      }

      test('trashed notes drop out of full-text search', async () => {
        await seedNote('zzftdel1', { memo: 'zzftdeltoken ライト' })
        expect(itemNos(await searchItems('zzftdeltoken', 1))).toEqual(['zzftdel1'])

        await trashItems(['zzftdel1'])

        expect(itemNos(await searchItems('zzftdeltoken', 1))).toEqual([])
      })

      test('trashed notes drop out of the empty-query browse too', async () => {
        // 一覧ブラウズは実データ込みで返るので、件数の差分で見る
        await seedNote('zzftdel2', { memo: 'zzftbrowsetoken' })
        const before = (await searchItems('', 1)).total

        await trashItems(['zzftdel2'])

        expect((await searchItems('', 1)).total).toBe(before - 1)
      })

      test('trashed notes drop out of the props table', async () => {
        await seedNote('zzftdelp1', {
          memo: '2SC0001\n#zzftdelbjt\nhFE=100',
          tags: ['zzftdelbjt'],
          props: [{ key: 'hfe', label: 'hFE', value: '100' }],
        })
        expect((await searchItemProps('#zzftdelbjt')).rows.map((r) => r.itemNo)).toEqual([
          'zzftdelp1',
        ])

        await trashItems(['zzftdelp1'])

        expect((await searchItemProps('#zzftdelbjt')).rows).toEqual([])
      })

      test('trashed notes drop out of the tag list (補完・集計)', async () => {
        await seedNote('zzftdelt1', { memo: 'zzfttagmemo #zzftdeltag', tags: ['zzftdeltag'] })
        expect((await listTags()).find((t) => t.tag === 'zzftdeltag')?.count).toBe(1)

        await trashItems(['zzftdelt1'])

        expect((await listTags()).find((t) => t.tag === 'zzftdeltag')).toBeUndefined()
      })

      test('restoreItems brings a note back into search', async () => {
        await seedNote('zzftres1', { memo: 'zzftrestoretoken' })
        await trashItems(['zzftres1'])
        expect(itemNos(await searchItems('zzftrestoretoken', 1))).toEqual([])

        await restoreItems(['zzftres1'])

        expect(itemNos(await searchItems('zzftrestoretoken', 1))).toEqual(['zzftres1'])
      })

      test('purgeItems deletes only rows that are already in the trash', async () => {
        // 二段階削除の要。通常ノートを渡しても消えてはいけない
        await seedNote('zzftpg1', { memo: 'zzftpurgetoken', deletedAt: new Date() })
        await seedNote('zzftpg2', { memo: 'zzftpurgetoken' })

        const purged = await purgeItems(['zzftpg1', 'zzftpg2'])

        // 戻り値は「実際に消えた itemNo」。git の墓石コミットが、消えていない
        // ノートの履歴まで消さないための口 (docs/57-ノートgit履歴計画.md §4)
        expect(purged).toEqual(['zzftpg1'])
        expect(await getItem('zzftpg1')).toBeNull()
        expect(await getItem('zzftpg2')).not.toBeNull()
      })

      test('getItem still returns a trashed note (/item のバナー用)', async () => {
        await seedNote('zzftget1', { memo: 'zzftgettoken', deletedAt: new Date() })

        expect((await getItem('zzftget1'))?.deletedAt).toBeInstanceOf(Date)
      })

      test('countTrashedMatches counts trashed hits only, for both text and tag terms', async () => {
        await seedNote('zzftcm1', { memo: 'zzftcmtoken #zzftcmtag', tags: ['zzftcmtag'] })
        await seedNote('zzftcm2', {
          memo: 'zzftcmtoken #zzftcmtag',
          tags: ['zzftcmtag'],
          deletedAt: new Date(),
        })

        // 通常ノート (zzftcm1) は数えず、ゴミ箱の 1 件だけ
        expect(await countTrashedMatches('zzftcmtoken')).toBe(1)
        expect(await countTrashedMatches('#zzftcmtag')).toBe(1)
      })

      test('countTrashedMatches honours NOT too (ゴミ箱案内にも否定が効く)', async () => {
        await seedNote('zzftcn1', {
          memo: 'zzftcntoken #zzftcnkeep',
          tags: ['zzftcnkeep'],
          deletedAt: new Date(),
        })
        await seedNote('zzftcn2', {
          memo: 'zzftcntoken #zzftcndrop',
          tags: ['zzftcndrop'],
          deletedAt: new Date(),
        })

        // ゴミ箱の 2 件のうち #zzftcndrop の付いた方だけ除外される
        expect(await countTrashedMatches('zzftcntoken')).toBe(2)
        expect(await countTrashedMatches('zzftcntoken !#zzftcndrop')).toBe(1)
      })

      test('listTrashedItems returns newest-deleted first, with the note itself', async () => {
        await seedNote('zzftlt1', {
          memo: 'ふるいノート\n本文',
          deletedAt: new Date('2026-01-01T00:00:00Z'),
        })
        await seedNote('zzftlt2', {
          memo: 'あたらしいノート\n本文',
          deletedAt: new Date('2026-02-01T00:00:00Z'),
        })

        const mine = (await listTrashedItems()).filter((r) => r.itemNo.startsWith('zzftlt'))

        expect(mine.map((r) => r.itemNo)).toEqual(['zzftlt2', 'zzftlt1'])
        // 大表示の本文プレビューと画像表示のタイルは本文から作るので、
        // 要約ではなく Item をそのまま返す (docs/67-ゴミ箱表示形式計画.md §2)
        expect(mine[0]?.memo).toBe('あたらしいノート\n本文')
      })

      // ゴミ箱にも並び順が効く (docs/67-ゴミ箱表示形式計画.md §2)。
      // 番号は昇順、削除日時は 1 が新しい方 — こうしておくと 3 つの並びが
      // それぞれ別の結果になり、指定が本当に SQL まで届いているか判る
      test('listTrashedItems sorts by the given order', async () => {
        await seedNote('zzftls1', {
          memo: 'ゴミ箱の並び 1',
          deletedAt: new Date('2026-02-01T00:00:00Z'),
        })
        await seedNote('zzftls2', {
          memo: 'ゴミ箱の並び 2',
          deletedAt: new Date('2026-01-01T00:00:00Z'),
        })

        const mineOf = async (sort: Parameters<typeof listTrashedItems>[0]) =>
          (await listTrashedItems(sort))
            .filter((r) => r.itemNo.startsWith('zzftls'))
            .map((r) => r.itemNo)

        expect(await mineOf('deleted')).toEqual(['zzftls1', 'zzftls2'])
        expect(await mineOf('deletedAsc')).toEqual(['zzftls2', 'zzftls1'])
        // 検索一覧と同じ種別も使える (番号順は item_no 昇順)
        expect(await mineOf('itemNo')).toEqual(['zzftls1', 'zzftls2'])
      })

      test('countTrashedItems counts the trash', async () => {
        const before = await countTrashedItems()

        await seedNote('zzftct1', { memo: 'zzftcounttoken', deletedAt: new Date() })

        expect(await countTrashedItems()).toBe(before + 1)
      })

      test('nextItemNo skips a number that is in the trash (番号の予約)', async () => {
        // ゴミ箱の間は番号を再利用しない (docs/12-ゴミ箱計画.md §4)。
        // 採番は item_no_num を見るのでここだけ数値 itemNo を使う。zzft の
        // 後始末には乗らないため finally で明示的に消す (docs/10 §7 の但し書き)。
        const no = await nextItemNo()
        try {
          await prisma.item.create({
            data: { itemNo: no, itemNoNum: Number(no), memo: '', deletedAt: new Date() },
          })

          expect(await nextItemNo()).not.toBe(no)
        } finally {
          await prisma.item.deleteMany({ where: { itemNo: no } })
        }
      })
    })

    // --- 公開 (docs/22-ノート公開計画.md) ---
    describe('公開 (setItemPublic / isPublicImageName)', () => {
      // 他の describe の seed を汚さないよう、この節で使うノートを都度作る。
      // zzft プレフィックスなので afterAll の後始末に乗る
      async function makeNote(
        suffix: string,
        data: { memo?: string; publicAt?: Date | null; deletedAt?: Date | null } = {},
      ): Promise<string> {
        const itemNo = `${TEST_PREFIX}pub${suffix}`
        await prisma.item.upsert({
          where: { itemNo },
          update: { memo: '', publicAt: null, deletedAt: null, ...data },
          create: { itemNo, itemNoNum: null, memo: '', ...data },
        })
        return itemNo
      }

      test('公開すると public_at が入り、やめると null に戻る', async () => {
        const itemNo = await makeNote('toggle')

        await setItemPublic(itemNo, true)
        expect((await getItem(itemNo))?.publicAt).toBeInstanceOf(Date)

        await setItemPublic(itemNo, false)
        expect((await getItem(itemNo))?.publicAt).toBeNull()
      })

      // 押し直すたびに公開日時が今へ進むのは嘘 (docs/22 §7)。
      // WHERE public_at IS NULL がそれを止めている
      test('公開中のノートへもう一度公開しても public_at を上書きしない', async () => {
        const itemNo = await makeNote('again')

        await setItemPublic(itemNo, true)
        const first = (await getItem(itemNo))?.publicAt

        const affected = await setItemPublic(itemNo, true)

        expect(affected).toBe(0)
        expect((await getItem(itemNo))?.publicAt).toEqual(first)
      })

      // 本文は変わっていないのに更新順が動くのは嘘 (trashItems と同じ理由)。
      // Prisma の update は @updatedAt を必ず打つので生 SQL で書いてある
      test('公開の切り替えは updated_at を触らない', async () => {
        const itemNo = await makeNote('touch')
        const before = (await getItem(itemNo))?.updatedAt

        await setItemPublic(itemNo, true)

        expect((await getItem(itemNo))?.updatedAt).toEqual(before)
      })

      test('公開ノートに貼った画像の名前は公開と判定する', async () => {
        const name = '0191f0c4-6f3b-7a1e-9c2d-4b5a6c7d8e9f.png'
        await makeNote('img', {
          memo: `写真 ![](/api/images/${name})`,
          publicAt: new Date(),
        })

        expect(await isPublicImageName(name)).toBe(true)
      })

      test('非公開ノートに貼った画像の名前は公開しない', async () => {
        const name = '0191f0c4-6f3b-7a1e-9c2d-4b5a6c7d8e01.png'
        await makeNote('imgpriv', { memo: `![](/api/images/${name})` })

        expect(await isPublicImageName(name)).toBe(false)
      })

      // isPublicItem() と同じ規則 (docs/22 §3)
      test('ゴミ箱の公開ノートに貼った画像は公開しない', async () => {
        const name = '0191f0c4-6f3b-7a1e-9c2d-4b5a6c7d8e02.png'
        await makeNote('imgtrash', {
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
        await makeNote('imgcase', {
          memo: `![](/api/images/${name.toUpperCase()})`,
          publicAt: new Date(),
        })

        expect(await isPublicImageName(name)).toBe(false)
      })
    })
  },
)
