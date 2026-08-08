// 検索履歴と登録パターンの読み書き (docs/59-検索候補計画.md §7)。
//
// **userName で仕切るのが要点**。履歴は「その人が何を探しているか」そのもので、
// 利用者が増えたときに混ざってはいけない。呼び出し側 (route) はセッションから
// 取った名前を渡す — リクエストの本文で名乗らせない。
//
// 並びは used_at が表す (降順 = 最近使った順)。同じ時刻に並んだときは id の
// 大きいほう = 後から入れたほうを先に出す。
//
// **意味づけは持たない**。前方一致の掃除・上限・「登録は履歴より強い」は
// searchQueries.ts の純関数が決める。ここはそれを DB の差分に翻訳するだけで、
// クライアントの楽観更新 (searchQueryClient.ts) と同じ答えになる。
//
// 読んで・計算して・書き戻すのをトランザクションの中でやる。JSON を 1 列で
// 持っていたら 2 台からの同時操作が後勝ちで消し合うが、1 クエリ = 1 行なので
// 衝突する範囲はそのクエリだけで済む。

import type { Prisma } from '@/generated/prisma/client'
import { prisma } from './db'
import {
  addSavedQuery,
  applyQueryUse,
  isSavedFull,
  QUERY_LIMIT,
  removeSavedQuery,
  touchSavedQuery,
  SAVED_LIMIT,
  type QueryLists,
} from './searchQueries'

// kind 列の値。表に入る文字列はこの 2 つだけ
const RECENT = 'recent'
const SAVED = 'saved'

type Tx = Prisma.TransactionClient

// その人の 2 つのリストを最近使った順で読む。
async function readLists(tx: Tx, userName: string): Promise<QueryLists> {
  const rows = await tx.searchQuery.findMany({
    where: { userName },
    orderBy: [{ usedAt: 'desc' }, { id: 'desc' }],
    select: { kind: true, query: true },
  })
  // 上限は書き手が守るが、読み出しでも切る。過去の不具合や手作業で
  // 増えた行があっても、画面に出る数だけは約束できるようにするため
  return {
    saved: rows
      .filter((r) => r.kind === SAVED)
      .map((r) => r.query)
      .slice(0, SAVED_LIMIT),
    recent: rows
      .filter((r) => r.kind === RECENT)
      .map((r) => r.query)
      .slice(0, QUERY_LIMIT),
  }
}

// 計算の結果いなくなった分を消す。
async function dropMissing(
  tx: Tx,
  userName: string,
  kind: string,
  before: readonly string[],
  after: readonly string[],
): Promise<void> {
  const removed = before.filter((q) => !after.includes(q))
  if (removed.length === 0) {
    return
  }
  await tx.searchQuery.deleteMany({
    where: { userName, kind, query: { in: removed } },
  })
}

// その人がいちばん最近使った時刻 (ミリ秒)。1 行も無ければ 0。
async function newestUsedAt(tx: Tx, userName: string): Promise<number> {
  const newest = await tx.searchQuery.findFirst({
    where: { userName },
    orderBy: [{ usedAt: 'desc' }],
    select: { usedAt: true },
  })
  return newest?.usedAt.getTime() ?? 0
}

// 「今使った」ことを表す時刻。**必ず既存の最大より後**にする。
//
// 時計をそのまま使うと、同じミリ秒に 2 回記録したときに並びが決まらない。
// 残った同着は id (= 作られた順) で解かれるので、**古い行を使い直したほうが
// 負ける** — 「最近使った順」が逆に出る。1ms 進めておけば必ず勝つ。
//
// 作るときも更新するときも同じ計算を通す。既定値 (DB の CURRENT_TIMESTAMP) に
// 任せると書き手が 2 つの時計に分かれ、ずれた分だけ並びが入れ替わる。
async function nextUsedAt(tx: Tx, userName: string): Promise<Date> {
  return new Date(Math.max(Date.now(), (await newestUsedAt(tx, userName)) + 1))
}

// 「今使った」を 1 行に刻む (無ければ作る)。
async function touch(tx: Tx, userName: string, kind: string, query: string): Promise<void> {
  const usedAt = await nextUsedAt(tx, userName)
  await tx.searchQuery.upsert({
    where: { userName_kind_query: { userName, kind, query } },
    create: { userName, kind, query, usedAt },
    update: { usedAt },
  })
}

// 上限を超えた分を落とす。
//
// **書いた後に読み直して数える**のが要点。呼び出し前に読んだ一覧から
// 「消える予定の物」を引く方式だと、2 台から同時に記録したときに両方が
// 同じ 1 行を消して各自 1 行を足し、11 行目が残る。しかも readLists は
// 上限で切って返すので、その 11 行目は以後どの計算にも現れず永久に居座る。
// 自分の書き込みを含めて数え直せば、競合しても必ず上限へ戻る。
async function trimToLimit(
  tx: Tx,
  userName: string,
  kind: string,
  limit: number,
): Promise<void> {
  const extra = await tx.searchQuery.findMany({
    where: { userName, kind },
    orderBy: [{ usedAt: 'desc' }, { id: 'desc' }],
    skip: limit,
    select: { id: true },
  })
  if (extra.length === 0) {
    return
  }
  await tx.searchQuery.deleteMany({ where: { id: { in: extra.map((r) => r.id) } } })
}

export async function listQueries(userName: string): Promise<QueryLists> {
  return readLists(prisma, userName)
}

// クエリを「使った」と記録する。返すのは記録後の 2 つのリスト。
//
// 呼ぶのは「意思表示」のときだけ (Enter・候補の確定・結果のノートを開く・
// タグを押す)。打鍵ごとの検索からは呼ばない — 呼ぶと打ちかけの語で枠が埋まる。
export async function recordUse(userName: string, query: string): Promise<QueryLists> {
  const q = query.trim()
  if (q === '') {
    return listQueries(userName)
  }
  return prisma.$transaction(async (tx) => {
    const before = await readLists(tx, userName)
    const after = applyQueryUse(before, q)
    // 登録済みなら登録パターンの側を触るだけ。履歴には足さない
    const kind = before.saved.includes(q) ? SAVED : RECENT
    // 前方一致の掃除 (「電」を消して「電験」を残す) は名前で消す
    await dropMissing(tx, userName, RECENT, before.recent, after.recent)
    await touch(tx, userName, kind, q)
    // 上限は書いた後に数え直して落とす (競合しても溜まらない)
    await trimToLimit(tx, userName, RECENT, QUERY_LIMIT)
    return after
  })
}

// ☆ を押して登録パターンに入れる。**満杯なら null** (呼び出し側が 409 にする)。
//
// 履歴からは消さない。表示のときに splitSuggestions が引くので二重には出ず、
// 外したときに履歴へ戻す手間も要らない (もとの localStorage 版と同じ扱い)。
export async function registerSaved(
  userName: string,
  query: string,
): Promise<QueryLists | null> {
  const q = query.trim()
  if (q === '') {
    return listQueries(userName)
  }
  return prisma.$transaction(async (tx) => {
    const before = await readLists(tx, userName)
    if (!before.saved.includes(q) && isSavedFull(before.saved)) {
      return null
    }
    // 既に登録済みなら先頭へ動かすだけ (二度押しで壊れない)。**返す並びも
    // 動かす** — 行の used_at は touch が進めるので、addSavedQuery の
    // 「登録済みなら何もしない」をそのまま返すと DB と食い違う
    await touch(tx, userName, SAVED, q)
    // 満杯は上で断っているが、2 台から同時に登録すれば擦り抜ける。
    // 溜め込まないよう、ここでも数え直して落とす
    await trimToLimit(tx, userName, SAVED, SAVED_LIMIT)
    return {
      saved: before.saved.includes(q)
        ? touchSavedQuery(before.saved, q)
        : addSavedQuery(before.saved, q),
      recent: before.recent,
    }
  })
}

// ★ を押して登録パターンから外す。
//
// **外すと同時に履歴へ入れる**。外した行はその場で 🕐 に変わるので、履歴に
// 実体が無いと「閉じて開いたら消えていた」になる (登録パターンとして使って
// いた間は履歴へ足していないため)。クライアントから 2 回叩かせず、ここで
// 1 つのトランザクションにまとめる。
export async function unregisterSaved(userName: string, query: string): Promise<QueryLists> {
  const q = query.trim()
  if (q === '') {
    return listQueries(userName)
  }
  return prisma.$transaction(async (tx) => {
    const before = await readLists(tx, userName)
    await tx.searchQuery.deleteMany({ where: { userName, kind: SAVED, query: q } })
    const after = applyQueryUse(
      { saved: removeSavedQuery(before.saved, q), recent: before.recent },
      q,
    )
    await dropMissing(tx, userName, RECENT, before.recent, after.recent)
    await touch(tx, userName, RECENT, q)
    await trimToLimit(tx, userName, RECENT, QUERY_LIMIT)
    return after
  })
}

// localStorage に残っていた登録パターンを引き取る (docs/59-検索候補計画.md §7)。
//
// **1 回のトランザクションでまとめて入れる**。1 件ずつ登録させると、途中で
// 満杯になったときにどこまで入ったのか呼び出し側が分からず、localStorage を
// 消してよいか判断できない。
//
// 並びは渡された順を保つ。used_at で並べる表なので、先頭ほど新しい時刻を振る。
export async function importSavedQueries(
  userName: string,
  queries: readonly string[],
): Promise<QueryLists> {
  if (queries.length === 0) {
    return listQueries(userName)
  }
  return prisma.$transaction(async (tx) => {
    const before = await readLists(tx, userName)
    // 渡された並びの**先頭から**入る分だけを取る。あふれたら切るのは末尾側
    // で、localStorage 側も最近使った順に並んでいたので、捨てるのは
    // いちばん使っていないパターンになる
    const added: string[] = []
    for (const q of queries) {
      const trimmed = q.trim()
      if (trimmed === '' || before.saved.includes(trimmed) || added.includes(trimmed)) {
        continue
      }
      if (isSavedFull([...added, ...before.saved])) {
        break
      }
      added.push(trimmed)
    }
    const saved = [...added, ...before.saved]
    // 先頭ほど新しい時刻を振る。既存の最大より後から始めることで、
    // 引き取った分が既にある登録パターンより前に並ぶ
    const base = Math.max(Date.now(), (await newestUsedAt(tx, userName)) + added.length)
    for (const [i, q] of added.entries()) {
      await tx.searchQuery.upsert({
        where: { userName_kind_query: { userName, kind: SAVED, query: q } },
        create: { userName, kind: SAVED, query: q, usedAt: new Date(base - i) },
        // 既にあるなら触らない。取り込みは「使った」ではないので順を動かさない
        update: {},
      })
    }
    await trimToLimit(tx, userName, SAVED, SAVED_LIMIT)
    return { saved, recent: before.recent }
  })
}
