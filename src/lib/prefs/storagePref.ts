// 端末に覚える小さな設定 (localStorage / sessionStorage) の読み書き
// (docs/93-リファクタリング計画.md §3-1)。
//
// どの設定も「使う分だけの Storage を引数で受ける純関数 + 例外を握る try/catch」
// の 3 点セットを手で書いていた。握る理由はどこでも同じなので、ここに 1 回だけ置く:
//
// - **Storage は触るだけで投げうる。** Safari のプライベートモードやブロック時は
//   getItem / setItem が SecurityError を、容量超過は QuotaExceededError を投げる
// - 設定は保険であって本筋ではない。読めなければ既定で動き、書けなくても
//   その場の切り替えは効いている (次に開くと既定に戻るだけ)
// - localStorage は手で書き換えられる外部入力。知らない値・壊れた値も既定に倒す
//
// 素で触ると、その例外が呼び出し元の効果を突き抜けて画面や下ごしらえを
// 丸ごと止める。何を既定にするか (= 読めないとき何が起きるか) は各設定の側で決める。

import 'client-only'

// localStorage は全部は要らないので、使う分だけの形で受ける (テストから偽物を渡せる)
export type PrefStorage = Pick<Storage, 'getItem' | 'setItem'>

type StorageKind = 'localStorage' | 'sessionStorage'

// window.localStorage / sessionStorage を取り出す。取れなければ null。
//
// **window.localStorage を触ること自体が例外になる**ブラウザがある
// (Cookie を全面禁止した Chrome など)。Firefox の dom.storage.enabled=false では
// 例外は出ずに undefined になる。window の有無を見るのは、Server Component から
// 間接的に呼ばれても落ちないようにするため
export function browserStorage(kind: StorageKind = 'localStorage'): Storage | null {
  try {
    return typeof window === 'undefined' ? null : (window[kind] ?? null)
  } catch {
    // 触れない環境は「Storage が無い」と同じ扱い (読めば既定、書けば何もしない)
    return null
  }
}

// 読めないとき (Storage が無い・投げる) は「記録が無い」と同じ null
export function readStorageItem(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  key: string,
): string | null {
  if (!storage) {
    return null
  }
  try {
    return storage.getItem(key) ?? null
  } catch {
    // 冒頭の理由で握る。呼び出し側は null を「未保存」として既定に倒す
    return null
  }
}

export function writeStorageItem(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  key: string,
  value: string,
): void {
  if (!storage) {
    return
  }
  try {
    storage.setItem(key, value)
  } catch {
    // 冒頭の理由で握る。覚えられないだけで、その場の操作は成立している
  }
}

export function removeStorageItem(
  storage: Pick<Storage, 'removeItem'> | null | undefined,
  key: string,
): void {
  if (!storage) {
    return
  }
  try {
    storage.removeItem(key)
  } catch {
    // 冒頭の理由で握る。消せないだけで、その場の操作は成立している
  }
}

export interface PrefSpec<T> {
  readonly key: string
  // 保存された生の文字列を値にする。投げてもよい (壊れた JSON など) — 既定に倒す
  readonly parse: (raw: string) => T
  readonly serialize: (value: T) => string
  // 未保存・読めない・壊れているときの値
  readonly fallback: T
}

export interface Pref<T> {
  readonly key: string
  // 生の値 (null = 未保存) を値にする。未保存・壊れた値は fallback
  parse(raw: string | null): T
  load(storage: PrefStorage | null | undefined): T
  save(storage: PrefStorage | null | undefined, value: T): void
  remove(storage: Pick<Storage, 'removeItem'> | null | undefined): void
}

export function definePref<T>({ key, parse, serialize, fallback }: PrefSpec<T>): Pref<T> {
  const parseOrFallback = (raw: string | null): T => {
    if (raw === null) {
      return fallback
    }
    try {
      return parse(raw)
    } catch {
      // 外部入力が壊れていただけ。既定で動けば足りる (冒頭の理由)
      return fallback
    }
  }
  return {
    key,
    parse: parseOrFallback,
    load: (storage) => parseOrFallback(readStorageItem(storage, key)),
    save: (storage, value) => writeStorageItem(storage, key, serialize(value)),
    remove: (storage) => removeStorageItem(storage, key),
  }
}

// ON/OFF の設定。'1' / '0' で覚え、それ以外 (未保存・知らない値) は fallback。
// fallback が false なら「'1' のときだけ立っている印」と同じ読み方になる
export function defineBooleanPref(key: string, fallback: boolean): Pref<boolean> {
  return definePref({
    key,
    parse: (raw) => {
      if (raw === '1') {
        return true
      }
      if (raw === '0') {
        return false
      }
      return fallback
    },
    serialize: (value) => (value ? '1' : '0'),
    fallback,
  })
}
