// 回路フェンスの抽出結果を DB に控えて引く (docs/122 §1)。
//
// 一覧の回路サムネと同期は、表示する本文ごとに回路フェンスを取り出す。
// remark の解析は本番で 1 件数 ms〜十数 ms かかり、プロセスの記憶 (fenceMemo.ts)
// は再起動・配布のたびに空になる。本文の sha1 を鍵に、取り出した結果を
// memo_circuit_fences に残し、2 回目からは 1 クエリで引く。
//
// 鍵が本文の中身なので、本文がどの経路で書き換わっても古い結果は引かれない。
// 控えに無い本文だけを解析し (記憶も通す)、結果を書き足す。DB が落ちていても
// 解析で返す (一覧・同期を道連れにしない)
import 'server-only'
import { prisma } from '@/lib/db'
import { circuitFencesOf, memoHash } from './fenceMemo'
import { type CircuitFence, hasNoCircuitFence, isCircuitLang } from './fences'

type FenceRow = { memoHash: string; fences: unknown }

export interface FenceStoreDeps {
  find: (hashes: readonly string[]) => Promise<FenceRow[]>
  save: (rows: readonly { memoHash: string; fences: readonly CircuitFence[] }[]) => Promise<void>
  parse: (memo: string) => readonly CircuitFence[]
}

const prismaDeps: FenceStoreDeps = {
  find: (hashes) =>
    prisma.memoCircuitFences.findMany({
      where: { memoHash: { in: [...hashes] } },
      select: { memoHash: true, fences: true },
    }),
  save: async (rows) => {
    await prisma.memoCircuitFences.createMany({
      data: rows.map((row) => ({ memoHash: row.memoHash, fences: row.fences as unknown as object[] })),
      // 同時に 2 本が同じ本文を書いても落とさない (中身は同じ)
      skipDuplicates: true,
    })
  },
  parse: circuitFencesOf,
}

// 控えの中身を検算する。形が違えば解析し直す (手で書き換えた行・将来の形の変更)
function toFences(value: unknown): readonly CircuitFence[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const ok = value.every(
    (f) => typeof f === 'object' && f !== null && isCircuitLang((f as CircuitFence).lang) && typeof (f as CircuitFence).source === 'string',
  )
  return ok ? Object.freeze(value as CircuitFence[]) : null
}

const NONE: readonly CircuitFence[] = Object.freeze([])

// 控えに無い本文を何件解析するごとに順番を譲るか。配布直後の同期は数百件を
// 続けて解析する (本番で 1 件数 ms〜十数 ms)。CPU だけの処理なので、譲らないと
// その間ほかの要求が一切進まない
const PARSE_YIELD_EVERY = 50

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

// 本文の並びと同じ順で、それぞれの回路フェンスを返す
export async function circuitFencesOfMany(
  memos: readonly string[],
  deps: FenceStoreDeps = prismaDeps,
): Promise<(readonly CircuitFence[])[]> {
  // 回路の言語名を含まない本文は**必ず**回路フェンスを持たない。引きにも行かない
  const keys = memos.map((memo) => (hasNoCircuitFence(memo) ? null : memoHash(memo)))
  const wanted = [...new Set(keys.filter((key): key is string => key !== null))]
  if (wanted.length === 0) {
    return memos.map(() => NONE)
  }

  const stored = new Map<string, readonly CircuitFence[]>()
  try {
    for (const row of await deps.find(wanted)) {
      const fences = toFences(row.fences)
      if (fences) stored.set(row.memoHash, fences)
    }
  } catch (error) {
    // 控えが引けなくても解析で返す。痕跡は残す (恒久的に落ちていると気づけない)
    console.warn('回路フェンスの控えを引けませんでした。解析で返します', error)
  }

  const fresh = new Map<string, readonly CircuitFence[]>()
  const result: (readonly CircuitFence[])[] = []
  for (const [index, memo] of memos.entries()) {
    const key = keys[index]
    const hit = key === null ? NONE : (stored.get(key) ?? fresh.get(key))
    if (hit !== undefined) {
      result.push(hit)
      continue
    }
    const fences = deps.parse(memo)
    fresh.set(key as string, fences)
    result.push(fences)
    if (fresh.size % PARSE_YIELD_EVERY === 0) {
      await yieldToEventLoop()
    }
  }

  if (fresh.size > 0) {
    // 書き足しの失敗は一覧を止めない (次に引いたときにまた解析して書く)
    await deps
      .save([...fresh].map(([memoHash, fences]) => ({ memoHash, fences })))
      .catch((error: unknown) => console.warn('回路フェンスの控えを書けませんでした', error))
  }
  return result
}
