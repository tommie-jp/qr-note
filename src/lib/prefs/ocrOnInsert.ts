// 画像を入れたときに OCR するかを端末に覚える (docs/106-OCR切替と全画像OCR計画.md §1)。
//
// **ノート単位ではなく端末単位**にする。イラストを描いて入れるのは
// Windows、部品の写真を撮って入れるのは iPhone、のように端末で使い分ける
// ことが多く、ノートごとに切り直すのは手間になる。
//
// 既定は ON (これまでの挙動)。一度も触っていない端末では何も変わらない。
// 流儀は prefs/livePreview.ts と同じ。読み書きの例外の扱いは prefs/storagePref.ts

import 'client-only'
import { defineBooleanPref, type PrefStorage } from './storagePref'

export const OCR_ON_INSERT_STORAGE_KEY = 'qr-search:ocr-on-insert'

export const OCR_ON_INSERT_DEFAULT = true

const OCR_ON_INSERT_PREF = defineBooleanPref(
  OCR_ON_INSERT_STORAGE_KEY,
  OCR_ON_INSERT_DEFAULT,
)

export function parseOcrOnInsertPref(raw: string | null): boolean {
  return OCR_ON_INSERT_PREF.parse(raw)
}

export function loadOcrOnInsertPref(
  storage: PrefStorage | null | undefined,
): boolean {
  return OCR_ON_INSERT_PREF.load(storage)
}

export function saveOcrOnInsertPref(
  storage: PrefStorage | null | undefined,
  enabled: boolean,
): void {
  OCR_ON_INSERT_PREF.save(storage, enabled)
}
