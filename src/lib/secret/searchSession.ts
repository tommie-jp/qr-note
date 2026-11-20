// シークレット内検索の状態 (docs/130-シークレット内検索計画.md §3-1, §5-3)。
// ブラウザ専用。
//
// 検索欄のトグルが入っている間だけ、復号したテキスト断片をタブのメモリに持つ。
// **平文はここにしか無い** — サーバにも IndexedDB にも一覧の控えにも出さない。
// 捨てるのは 3 つの時:
//
//   - トグルを切った
//   - 施錠された (無操作 5 分・タブを隠して 1 分・頁を離れる。secret/session.ts)
//   - 再読み込み (モジュールごと消える。トグルの状態は保存しない)
//
// 照合 (secret/search.ts) は鍵に触れない。鍵を使うのは読み込みの 1 回だけなので、
// 照合のたびに noteSecretSearchUse で無操作の数え直しをする (§5-3)。探して
// いる間は施錠されず、手を止めて 5 分で施錠される。

import type { Item } from '@/generated/prisma/client'
import {
  loadSecretTextCache,
  saveSecretTextCache,
} from '../offline/secretTexts'
import { createExternalStore } from '../prefs/externalStore'
import { secretContext, SecretLockedError } from './content'
import { openSecret } from './envelope'
import { SECRET_TEXT_MIME } from './payload'
import { SecretCancelledError } from './prf'
import {
  chunkSecretFetch,
  normalizeSecretText,
  planSecretSync,
  type CachedSecretText,
  type SecretTextEntry,
} from './search'
import { fetchSecretTextBlobs, fetchSecretTextIndex } from './searchApi'
import { setSecretSearchActive, subscribeSecretSearchReload } from './searchPrivacy'
import { isUnlocked, subscribeSecretLock, touchSecretSession, unlockedKey } from './session'
import { unlockWithPasskey } from './unlock'

export interface SecretSearchIndex {
  // 照合できる断片の一覧 (参照元ノートつき)
  entries: SecretTextEntry[]
  // シークレットを含むノート (入れたときの写し)。一致を通常の一覧の行として
  // 描く材料 (docs/131)。検索語に関係なく全部持つ
  notes: ReadonlyMap<string, Item>
  // 名前 → 正規化済みの平文。**メモリの外へ出さない**
  haystacks: ReadonlyMap<string, string>
  // 上限を超えて対象外にした数 (docs/130 §7)
  skipped: number
  // 取れなかった・復号できなかった数
  failed: number
}

export type SecretSearchState =
  // error … 入れようとして失敗した理由 (取り消しは理由なしで off に戻る)
  // lockedOut … 入っていたのに自動施錠で切れた。黙って切ると「検索できなく
  //             なった」ように見えるので、節が理由を出す
  | { status: 'off'; error: string | null; lockedOut: boolean }
  | { status: 'loading' }
  | { status: 'on'; index: SecretSearchIndex }

const OFF: SecretSearchState = { status: 'off', error: null, lockedOut: false }
const LOCKED_OUT: SecretSearchState = { status: 'off', error: null, lockedOut: true }

const store = createExternalStore<SecretSearchState>({
  initial: () => OFF,
  serverSnapshot: OFF,
})

// 状態を差し替える唯一の口。「入っているか」を searchPrivacy へ写してから知らせる
// (検索履歴・一覧の控えはあちらだけを読む)
function setState(next: SecretSearchState): void {
  setSecretSearchActive(next.status !== 'off')
  store.set(next)
}

// 入れる操作の通し番号。読み込みの途中で切られた・施錠されたとき、遅れて
// 届いた結果を捨てるために使う (捨てないと、切った後に平文が居座る)
let generation = 0
let listeningToLock = false

// 施錠されたら平文を捨てる。購読は 1 度だけ張る
function listenToLockOnce(): void {
  if (listeningToLock) {
    return
  }
  listeningToLock = true
  subscribeSecretSearchReload(() => void reloadSecretSearch())
  subscribeSecretLock(() => {
    if (!isUnlocked()) {
      // 入っていたときだけ「施錠で切れた」と知らせる (読み込み中なら黙って戻す)
      const wasOn = store.get().status === 'on'
      disableSecretSearch()
      if (wasOn) {
        setState(LOCKED_OUT)
      }
    }
  })
}

// 検索語を照合した印。**照合のたびに無操作の数え直しをする** — 照合は鍵に
// 触れないので、これが無いと入れて 5 分で必ず施錠され、探している最中に
// トグルが切れる (session.ts の touchSecretSession)
export function noteSecretSearchUse(): void {
  if (store.get().status === 'on') {
    touchSecretSession()
  }
}

export function useSecretSearch(): SecretSearchState {
  return store.useStore()
}

// いまの状態 (React の外から読む用)
export function secretSearchState(): SecretSearchState {
  return store.get()
}

// トグルを切る。平文と一覧を捨てる。**施錠はしない** — 開いているノートの
// 断片まで閉じてしまうため (docs/130 §3-1)
export function disableSecretSearch(): void {
  generation += 1
  wantsReload = false
  if (store.get() !== OFF) {
    setState(OFF)
  }
}

// トグルを入れる。未解錠なら解錠 (Face ID) から。
// 失敗は投げずに state の error に入れる (釦の下に出す)。
export async function enableSecretSearch(): Promise<void> {
  if (store.get().status !== 'off') {
    return
  }
  listenToLockOnce()
  generation += 1
  const run = generation
  setState({ status: 'loading' })
  try {
    if (!isUnlocked()) {
      await unlockWithPasskey()
    }
    const isCurrent = () => run === generation
    // 解錠を待つ間に切られていたら、断片を取りにも行かない
    const index = isCurrent() ? await loadSecretSearchIndex(isCurrent) : null
    if (index !== null && isCurrent()) {
      setState({ status: 'on', index })
      if (wantsReload) {
        wantsReload = false
        void reloadSecretSearch()
      }
    }
  } catch (cause) {
    if (run === generation) {
      setState({ status: 'off', error: enableErrorMessage(cause), lockedOut: false })
    }
  }
}

// 書き込みの後の取り直し (docs/131 §6)。入っている間だけ、材料を取り直して
// 差し替える。**失敗しても切らない** — 古い写しのまま探せるほうがよい。
// 取り直しの最中に次の合図が来たら、終わってからもう 1 度だけ取り直す
let isReloading = false
let wantsReload = false

async function reloadSecretSearch(): Promise<void> {
  if (store.get().status === 'loading') {
    // 読み込みの最中の書き込み。入った直後に 1 度取り直す (enableSecretSearch)
    wantsReload = true
    return
  }
  if (store.get().status !== 'on') {
    return
  }
  if (isReloading) {
    wantsReload = true
    return
  }
  isReloading = true
  const run = generation
  const isCurrent = () => run === generation && store.get().status === 'on'
  try {
    const index = await loadSecretSearchIndex(isCurrent)
    if (isCurrent()) {
      setState({ status: 'on', index })
    }
  } catch (cause) {
    console.warn('シークレット内検索の材料を取り直せませんでした', cause)
  } finally {
    isReloading = false
  }
  if (wantsReload) {
    wantsReload = false
    await reloadSecretSearch()
  }
}

function enableErrorMessage(cause: unknown): string | null {
  if (cause instanceof SecretCancelledError) {
    return null // 自分でやめた操作は失敗として出さない (useSecretReveal と同じ)
  }
  console.error('シークレット内検索を始められませんでした', cause)
  return cause instanceof Error && !(cause instanceof SecretLockedError)
    ? cause.message
    : 'シークレット内検索を始められませんでした'
}

// 一覧を取り、控えと比べて足りない暗号文だけを取り、復号して照合の形にする。
// isCurrent が偽になったら (切られた・施錠された) 復号をやめる — 捨てられる
// 平文を、施錠の後まで作り続けない
async function loadSecretSearchIndex(isCurrent: () => boolean): Promise<SecretSearchIndex> {
  const key = unlockedKey()
  if (key === null) {
    throw new SecretLockedError()
  }

  const { entries, items } = await fetchSecretTextIndex()
  const { ciphertexts, wanted, skipped } = await syncCiphertexts(entries, isCurrent)

  const haystacks = new Map<string, string>()
  const decoder = new TextDecoder()
  for (const [name, row] of ciphertexts) {
    if (!isCurrent()) {
      break
    }
    try {
      const plain = await openSecret(key, row.data, secretContext(name, SECRET_TEXT_MIME))
      haystacks.set(name, normalizeSecretText(decoder.decode(plain)))
    } catch (cause) {
      // 1 件開けなくても残りは探せる。数だけ画面に出す
      console.warn(`シークレットを復号できませんでした (${name})`, cause)
    }
  }

  return {
    entries: entries.filter((entry) => haystacks.has(entry.name)),
    notes: new Map(items.map((item) => [item.itemId, item])),
    haystacks,
    skipped,
    // 取りに行ったのに返ってこなかった分 (直前に消えた) も、復号できなかった分も
    // 「対象にしたかったが探せない」ので 1 つに数える
    failed: wanted - haystacks.size,
  }
}

interface SyncedCiphertexts {
  ciphertexts: Map<string, CachedSecretText>
  // 対象にしようとした数 (上限で外した分は含まない)
  wanted: number
  // 上限で外した数
  skipped: number
}

// いま要る暗号文を揃える。控えにある分は使い回し、無い・変わった分だけ取る。
// 控えの読み書きに失敗しても検索は続ける (全部取り直しになるだけ)。
//
// **途中で止まっても、取れた分は控えに残す** (finally)。キャリア回線で 3 束目が
// 落ちたとき、次に入れ直したら 1 束目から取り直し、にしない。切られた・施錠
// されたとき (isCurrent が偽) は残りを取りに行かない
async function syncCiphertexts(
  entries: readonly SecretTextEntry[],
  isCurrent: () => boolean,
): Promise<SyncedCiphertexts> {
  const cached = await loadCacheOrEmpty()
  const plan = planSecretSync(entries, cached)
  const byName = new Map(entries.map((entry) => [entry.name, entry]))

  const current = new Map<string, CachedSecretText>()
  for (const name of plan.keep) {
    const row = cached.get(name)
    if (row !== undefined) {
      current.set(name, row)
    }
  }
  let fetched = 0
  try {
    for (const chunk of chunkSecretFetch(plan.fetch, (name) => byName.get(name)?.bytes ?? 0)) {
      if (!isCurrent()) {
        break
      }
      const blobs = await fetchSecretTextBlobs(chunk)
      for (const [name, data] of blobs) {
        current.set(name, { hash: byName.get(name)?.hash ?? '', data })
        fetched += 1
      }
    }
  } finally {
    if (fetched > 0 || cached.size !== current.size) {
      await saveCacheQuietly(current)
    }
  }
  return {
    ciphertexts: current,
    wanted: plan.keep.length + plan.fetch.length,
    skipped: plan.skipped,
  }
}

async function saveCacheQuietly(cache: ReadonlyMap<string, CachedSecretText>): Promise<void> {
  try {
    await saveSecretTextCache(cache)
  } catch (cause) {
    console.warn('シークレット内検索の控えを保存できませんでした', cause)
  }
}

async function loadCacheOrEmpty(): Promise<Map<string, CachedSecretText>> {
  try {
    return await loadSecretTextCache()
  } catch (cause) {
    console.warn('シークレット内検索の控えを読めませんでした', cause)
    return new Map()
  }
}
