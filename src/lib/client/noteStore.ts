// 端末側のノートの控え (docs/123 §3-2)。
//
// 読みの順は 写し (IndexedDB の同期データ) → 控え → API。写しは本文を
// 即座に出すためだけに使い、公開・オフラインの印・ゴミ箱の状態は API の
// 応答 (控え) が届いてから出す (写しはそれらを持たない)。
//
// 書き込みの後は noteWritten() を呼ぶ。そのノートの描画材料と、一覧・前後・
// タグ・フォルダーの控えに「古い」印を付ける (§3-3 の表)
import 'client-only'
import type { Item } from '@/generated/prisma/client'
import { isItemDto, reviveItem, type ItemDto } from '@/lib/api/itemDto'
import type { CircuitMap, CircuitResult } from '@/lib/circuit/types'
import type { HealthMap, HealthResult } from '@/lib/health/healthData'
import type { MatrixMap, MatrixResult } from '@/lib/matrix/matrixData'
import { apiGet } from './api'
import { createResourceCache } from './resourceCache'

export interface NoteEntryValue {
  // 未登録の id は null (その場で書いて新規作成できる)
  item: Item | null
}

function itemPath(itemId: string, suffix = ''): string {
  return `/api/items/${encodeURIComponent(itemId)}${suffix}`
}

export const noteCache = createResourceCache<string, NoteEntryValue>({
  async fetch(itemId) {
    const { data } = await apiGet<{ item: unknown }>(itemPath(itemId))
    const raw = (data as { item?: unknown } | null)?.item
    if (raw === null) {
      return { item: null }
    }
    if (!isItemDto(raw)) {
      throw new Error('ノートの形が違います')
    }
    return { item: reviveItem(raw) }
  },
})

// 一覧の応答で届いたノートを控えに入れる。開いたときに取り直さずに済む
// (一覧の行とノートは同じ ItemDto)。既に新しい控えがあれば触らない
export function primeNotes(dtos: readonly ItemDto[]): void {
  for (const dto of dtos) {
    const current = noteCache.peek(dto.itemId)?.value?.item
    if (current && current.updatedAt.getTime() >= Date.parse(dto.updatedAt)) {
      continue
    }
    noteCache.set(dto.itemId, { item: reviveItem(dto) })
  }
}

export interface NoteRender {
  matrices: MatrixMap
  health: HealthMap
  attachmentBytes: number
}

function isPairs(value: unknown): value is [string, unknown][] {
  return (
    Array.isArray(value) &&
    value.every((pair) => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string')
  )
}

export interface RenderKey {
  itemId: string
  // false なら添付量だけ (表・健康のフェンスを持たないノート)
  full: boolean
}

export const renderCache = createResourceCache<RenderKey, NoteRender>({
  keyOf: ({ itemId, full }) => `${itemId}\u0000${full ? 'full' : 'bytes'}`,
  async fetch({ itemId, full }) {
    const { data } = await apiGet<Record<string, unknown>>(
      itemPath(itemId, full ? '/render' : '/render?only=bytes'),
    )
    const { matrices, health, attachmentBytes } = (data ?? {}) as Record<string, unknown>
    if (!isPairs(matrices) || !isPairs(health) || typeof attachmentBytes !== 'number') {
      throw new Error('ノートの集計の形が違います')
    }
    return {
      matrices: new Map(matrices as [string, MatrixResult][]),
      health: new Map(health as [string, HealthResult][]),
      attachmentBytes,
    }
  },
})

export const circuitsCache = createResourceCache<string, CircuitMap>({
  async fetch(itemId) {
    const { data } = await apiGet<Record<string, unknown>>(itemPath(itemId, '/circuits'))
    const { circuits } = (data ?? {}) as Record<string, unknown>
    if (!isPairs(circuits)) {
      throw new Error('回路図の形が違います')
    }
    return new Map(circuits as [string, CircuitResult][])
  },
})

export interface Neighbors {
  prev: string | null
  next: string | null
}

export interface NeighborsKey {
  itemId: string
  query: string
  sort: string
}

export const neighborsCache = createResourceCache<NeighborsKey, Neighbors>({
  keyOf: ({ itemId, query, sort }) => `${itemId}\u0000${query}\u0000${sort}`,
  async fetch({ itemId, query, sort }) {
    const params = new URLSearchParams({ q: query, sort })
    const { data } = await apiGet<Record<string, unknown>>(
      `${itemPath(itemId, '/neighbors')}?${params}`,
    )
    const { prev, next } = (data ?? {}) as Record<string, unknown>
    const isId = (v: unknown): v is string | null => v === null || typeof v === 'string'
    if (!isId(prev) || !isId(next)) {
      throw new Error('前後のノートの形が違います')
    }
    return { prev, next }
  },
})

// 描き終えるまで「準備中」を出すための、鍵ごとの約束の表。
//
// CircuitDiagram は約束を use() で待つ。約束は**同じものを返し続ける**
// 必要がある (描き直しのたびに作り直すと Suspense が抜けない) ので、
// 鍵ごとに 1 度だけ作って覚える。届いた表に鍵が無いのは本文と表が
// ずれたとき (書き換えの直後) で、そのときは図の場所に断りを出す
const MISSING_CIRCUIT: CircuitResult = {
  error: '回路図を読み込めませんでした。画面を開き直してください',
  texLog: '',
}

export class PendingCircuits extends Map<string, CircuitResult | Promise<CircuitResult>> {
  readonly #source: Promise<CircuitMap>

  constructor(source: Promise<CircuitMap>) {
    super()
    this.#source = source
    // 図を 1 つも引かないまま失敗しても、拾われない reject にしない
    // (失敗は get が図の場所に断りとして出す)
    source.catch(() => {})
  }

  override get(key: string): CircuitResult | Promise<CircuitResult> {
    const known = super.get(key)
    if (known !== undefined) {
      return known
    }
    const pending = this.#source.then(
      (map) => map.get(key) ?? MISSING_CIRCUIT,
      (): CircuitResult => ({
        error: '回路図を読み込めませんでした (通信の失敗)',
        texLog: '',
      }),
    )
    super.set(key, pending)
    return pending
  }
}
