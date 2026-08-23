// memo 編集中の下書きを localStorage に退避する (docs/24-画像OCR計画.md §9)。
//
// 本文はフォームを「更新」するまでブラウザの state にしか無く、タブが落ちると
// 消える。特に iPhone は OCR のモデル読み込み (WASM + モデルで数百 MB 級) で
// WebKit がタブごと再起動することがあり、その瞬間に編集内容が失われる。
// 編集のたびに下書きを残し、再訪時にサーバ値と食い違っていれば復元を促す。
//
// ここは純粋なロジックだけを持つ (Storage は引数で受ける)。debounce や
// effect の結線は MemoEditor 側。

import { BASE_STALE } from './saveBase'

export interface MemoDraft {
  value: string
  savedAt: number
  // この本文が載っていた版 (docs/87-編集競合対策計画.md §2-6)。
  // **本文と対で持つ**のが要点 — 基点を持たずに復元すると、古い本文を
  // 「いまの版」の顔で保存でき、別の端末の保存を黙って潰せてしまう。
  // 古い下書き (この列を持たない頃のもの) だけ undefined になる
  base?: string
}

// 復元する下書き。基点を持たない古い下書きは BASE_STALE で返し、
// 保存時に必ず競合として見せる (いまの版を当ててしまわない)
export interface RestoredDraft {
  value: string
  base: string
}

// localStorage を全部は要らないので、使う分だけの形で受ける (テスト容易性)
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function draftStorageKey(draftKey: string): string {
  return `qr-search:memo-draft:${draftKey}`
}

// 壊れた JSON や形の違う値は null (localStorage は外部入力として扱う)
export function parseDraft(raw: string | null): MemoDraft | null {
  if (raw === null) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as MemoDraft).value === 'string' &&
      typeof (parsed as MemoDraft).savedAt === 'number'
    ) {
      const draft = parsed as MemoDraft
      return {
        value: draft.value,
        savedAt: draft.savedAt,
        // 形の違う base は無かったことにする (古い下書きと同じ扱い = stale)
        ...(typeof draft.base === 'string' ? { base: draft.base } : {}),
      }
    }
    return null
  } catch {
    return null
  }
}

// 編集のたびに呼ぶ (呼び手が debounce する)。初期値と同じなら下書きは不要 —
// 消しておかないと「保存 → 再訪」で古い下書きを永遠に持ち続ける
export function persistDraft(
  storage: DraftStorage,
  draftKey: string,
  value: string,
  initialValue: string,
  base: string,
  savedAt: number,
): void {
  const key = draftStorageKey(draftKey)
  if (value === initialValue) {
    storage.removeItem(key)
    return
  }
  const draft: MemoDraft = { value, savedAt, base }
  storage.setItem(key, JSON.stringify(draft))
}

// マウント時に呼ぶ。復元すべき下書きの本文を返す (無ければ null)。
// サーバ値と同じ下書き (=保存が成功した後の残骸) と壊れた下書きは掃除する
export function loadDraft(
  storage: DraftStorage,
  draftKey: string,
  initialValue: string,
): RestoredDraft | null {
  const key = draftStorageKey(draftKey)
  const draft = parseDraft(storage.getItem(key))
  if (draft === null || draft.value === initialValue) {
    storage.removeItem(key)
    return null
  }
  return { value: draft.value, base: draft.base ?? BASE_STALE }
}
