// 鍵ごとの取得結果を覚え、古い値を見せながら取り直す入れ物 (docs/123 §3-2)。
//
// stale-while-revalidate を 1 か所で持つ:
//
//   - 値があれば即座に返す。古ければ (stale) 裏で取り直し、届いたら差し替える
//   - 同じ鍵の取得が進行中なら相乗りする (二重に撃たない)
//   - 書き込みの後は invalidate で「古い」印を付ける。消さないので、取り直しの
//     間も前の結果が画面に残る (白くならない)
//   - 届いてから maxAgeMs を過ぎた値は、画面が鍵を購読し始めたときに裏で
//     取り直す (別の端末で書き換えた分を拾う。書き込みの印だけでは自分の
//     端末の変更しか分からない)
//   - **失敗した後は自分からは撃ち直さない。** 圏外やサーバの失敗の間、
//     描き直しのたびに撃つと電池とサーバを食い続ける。撃ち直すのは
//     invalidate・期限切れでの開き直し・画面の「もう一度」だけ
//
// 項目 (Entry) は書き換えずに作り直す。useSyncExternalStore はこの同一性で
// 変化を見るので、中身を書き換えると描き直されない。
//
// ライブラリ (SWR / TanStack Query) を入れない理由は docs/123 §9-2
import { useEffect, useSyncExternalStore } from 'react'
import { createNotifier } from '@/lib/prefs/externalStore'

export interface Entry<V> {
  readonly value: V | undefined
  readonly error: Error | null
  readonly stale: boolean
  readonly loading: boolean
  // 値が届いた時刻 (Date.now)。まだ届いていなければ 0
  readonly at: number
}

export interface ResourceCache<K, V> {
  peek(key: K): Entry<V> | undefined
  load(key: K, options?: { force?: boolean }): Promise<V>
  set(key: K, value: V): void
  update(key: K, fn: (value: V) => V): void
  invalidate(match?: (key: K) => boolean): void
  remove(match: (key: K) => boolean): void
  subscribe(listener: () => void): () => void
  // 鍵の項目を購読する。値が無いか古ければ取りに行く。key が null なら何もしない
  useEntry(key: K | null, options?: UseEntryOptions): Entry<V> | undefined
  keys(): K[]
}

export interface UseEntryOptions {
  // 取りに行くのを次の描画が画面に出た後へ回す。前の結果をすぐ出せる画面
  // (表示モードの切替) で、届いた応答の描き直しが最初の描画に混ざらないように
  afterPaint?: boolean
}

export interface ResourceCacheOptions<K, V> {
  fetch: (key: K) => Promise<V>
  // 鍵を Map の鍵にする文字列へ
  keyOf?: (key: K) => string
  // 覚えておく鍵の上限。超えたら古い順に捨てる
  maxEntries?: number
  // 届いてからこの時間を過ぎた値は、購読し始めたときに裏で取り直す
  maxAgeMs?: number
  // 時計 (テストで差し替える)
  now?: () => number
}

const DEFAULT_MAX_ENTRIES = 200
const DEFAULT_MAX_AGE_MS = 30_000

export function createResourceCache<K, V>({
  fetch,
  keyOf = (key) => String(key),
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  now = Date.now,
}: ResourceCacheOptions<K, V>): ResourceCache<K, V> {
  const notifier = createNotifier()
  const entries = new Map<string, Entry<V>>()
  const rawKeys = new Map<string, K>()
  const inflight = new Map<string, Promise<V>>()
  // 取得の世代。取り直しの途中で set / invalidate が入ったら、遅れて届いた
  // 古い応答で上書きしない
  const generation = new Map<string, number>()

  function put(id: string, key: K, entry: Entry<V>): void {
    entries.delete(id)
    entries.set(id, entry)
    rawKeys.set(id, key)
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) {
        break
      }
      entries.delete(oldest)
      rawKeys.delete(oldest)
    }
    notifier.notify()
  }

  function bump(id: string): number {
    const next = (generation.get(id) ?? 0) + 1
    generation.set(id, next)
    return next
  }

  function load(key: K, { force = false } = {}): Promise<V> {
    const id = keyOf(key)
    const current = entries.get(id)
    if (!force && current?.value !== undefined && !current.stale) {
      return Promise.resolve(current.value)
    }
    const running = inflight.get(id)
    if (running) {
      return running
    }
    const gen = bump(id)
    put(id, key, {
      value: current?.value,
      error: null,
      stale: current?.stale ?? false,
      loading: true,
      at: current?.at ?? 0,
    })
    const promise = fetch(key).then(
      (value) => {
        inflight.delete(id)
        if (generation.get(id) === gen) {
          put(id, key, { value, error: null, stale: false, loading: false, at: now() })
        }
        return value
      },
      (error: unknown) => {
        inflight.delete(id)
        if (generation.get(id) === gen) {
          const latest = entries.get(id)
          put(id, key, {
            value: latest?.value,
            error: error instanceof Error ? error : new Error(String(error)),
            stale: latest?.stale ?? false,
            loading: false,
            at: latest?.at ?? 0,
          })
        }
        throw error
      },
    )
    inflight.set(id, promise)
    return promise
  }

  function set(key: K, value: V): void {
    const id = keyOf(key)
    bump(id)
    inflight.delete(id)
    put(id, key, { value, error: null, stale: false, loading: false, at: now() })
  }

  function update(key: K, fn: (value: V) => V): void {
    const current = entries.get(keyOf(key))?.value
    if (current !== undefined) {
      set(key, fn(current))
    }
  }

  function invalidate(match: (key: K) => boolean = () => true): void {
    let changed = false
    for (const [id, entry] of entries) {
      const key = rawKeys.get(id)
      if (key === undefined || !match(key)) {
        continue
      }
      bump(id)
      inflight.delete(id)
      // 失敗の記録も消す。古い印は「撃ち直してよい」の合図でもある
      entries.set(id, { ...entry, stale: true, loading: false, error: null })
      changed = true
    }
    if (changed) {
      notifier.notify()
    }
  }

  function remove(match: (key: K) => boolean): void {
    let changed = false
    for (const [id, key] of [...rawKeys]) {
      if (match(key)) {
        bump(id)
        inflight.delete(id)
        entries.delete(id)
        rawKeys.delete(id)
        changed = true
      }
    }
    if (changed) {
      notifier.notify()
    }
  }

  function useEntry(key: K | null, { afterPaint = false }: UseEntryOptions = {}): Entry<V> | undefined {
    const id = key === null ? null : keyOf(key)
    const entry = useSyncExternalStore(
      notifier.subscribe,
      () => (id === null ? undefined : entries.get(id)),
      () => undefined,
    )
    // 失敗の記録がある間は撃たない (上の約束)
    const needsLoad =
      key !== null &&
      (entry === undefined || entry.stale || entry.value === undefined) &&
      !entry?.loading &&
      (entry?.error ?? null) === null
    useEffect(() => {
      if (!needsLoad || key === null) {
        return
      }
      const start = () => {
        load(key).catch(() => {
          // 失敗は項目の error に入る。画面はそれを見て知らせる
        })
      }
      if (!afterPaint || typeof requestAnimationFrame !== 'function') {
        start()
        return
      }
      // 次の描画の後 (rAF → setTimeout 0)。描画の前に始めると、手元のように
      // 応答が速い所では届いた一覧の描き直しが最初の描画に混ざる
      let timer: ReturnType<typeof setTimeout> | undefined
      const frame = requestAnimationFrame(() => {
        timer = setTimeout(start, 0)
      })
      return () => {
        cancelAnimationFrame(frame)
        if (timer !== undefined) {
          clearTimeout(timer)
        }
      }
      // key は id と一対一。オブジェクトの鍵でも id で比べれば足りる
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, needsLoad])
    // 購読し始めたとき、期限を過ぎた値なら裏で取り直す (鍵が替わるたびに 1 回)
    useEffect(() => {
      if (key === null) {
        return
      }
      const current = entries.get(keyOf(key))
      if (
        current?.value !== undefined &&
        !current.loading &&
        !current.stale &&
        now() - current.at > maxAgeMs
      ) {
        load(key, { force: true }).catch(() => {})
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id])
    return entry
  }

  return {
    peek: (key) => entries.get(keyOf(key)),
    load,
    set,
    update,
    invalidate,
    remove,
    subscribe: notifier.subscribe,
    useEntry,
    keys: () => [...rawKeys.values()],
  }
}
