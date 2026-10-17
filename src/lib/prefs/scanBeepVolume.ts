// スキャンの読み取り音の大きさを端末に覚える (docs/112-スキャン音量計画.md)。
//
// **端末ごと**にする。iPhone のスピーカーと PC のスピーカーでは同じ音量でも
// 聞こえ方が違い、図書館では iPhone だけ黙らせたい、のように使い分ける
// (テキストサイズと同じ判断。選択色のような user_settings には置かない)。
//
// 音量は**波形の振幅に焼き込む** (audio/scanBeepWav.ts)。iOS は
// HTMLMediaElement の volume を JS から変えられないので、再生側で絞る手は
// iPhone で効かない。段ごとに振幅の違う WAV を作り、読み取りライブラリの
// sound に渡す。
//
// 段は離散にする。連続のスライダーは片手で狙いにくく、「元に戻す」が
// 曖昧になる (prefs/noteFontScale.ts と同じ理由)。振幅は等比 (約 −6〜−8 dB
// 刻み) にして、1 段ごとの聞こえ方の差を揃える。読み取り例外の扱いは
// prefs/storagePref.ts

import 'client-only'
import { definePref, type PrefStorage } from './storagePref'

export const SCAN_BEEP_VOLUME_STORAGE_KEY = 'qr-search:scan-beep-volume'

export const SCAN_BEEP_LEVELS = [
  { id: 'off', label: '消音', amplitude: 0 },
  { id: 'low', label: '小', amplitude: 0.2 },
  { id: 'mid', label: '中', amplitude: 0.5 },
  { id: 'high', label: '大', amplitude: 1 },
] as const

export type ScanBeepLevel = (typeof SCAN_BEEP_LEVELS)[number]['id']

// **既定は「大」**。この設定を足す前から、ライブラリ内蔵のビープが
// 全開で鳴っていた。触っていない端末の音量を黙って下げない
export const DEFAULT_SCAN_BEEP_LEVEL: ScanBeepLevel = 'high'

function isScanBeepLevel(raw: string): raw is ScanBeepLevel {
  return SCAN_BEEP_LEVELS.some((level) => level.id === raw)
}

// 知らない値 (手で書き換えた・段を後から変えた) は既定に倒す
const SCAN_BEEP_VOLUME_PREF = definePref<ScanBeepLevel>({
  key: SCAN_BEEP_VOLUME_STORAGE_KEY,
  parse: (raw) => (isScanBeepLevel(raw) ? raw : DEFAULT_SCAN_BEEP_LEVEL),
  serialize: (level) => level,
  fallback: DEFAULT_SCAN_BEEP_LEVEL,
})

export function parseScanBeepLevel(raw: string | null): ScanBeepLevel {
  return SCAN_BEEP_VOLUME_PREF.parse(raw)
}

export function loadScanBeepLevel(
  storage: PrefStorage | null | undefined,
): ScanBeepLevel {
  return SCAN_BEEP_VOLUME_PREF.load(storage)
}

export function saveScanBeepLevel(
  storage: PrefStorage | null | undefined,
  level: ScanBeepLevel,
): void {
  SCAN_BEEP_VOLUME_PREF.save(storage, level)
}

function levelIndex(level: ScanBeepLevel): number {
  return SCAN_BEEP_LEVELS.findIndex((entry) => entry.id === level)
}

// ＋ / − を 1 段動かす。端では動かない (押しても行き過ぎない)。
// ボタンの disabled もこの結果と突き合わせて決めるので、端の判断はここだけ
export function stepScanBeepLevel(
  current: ScanBeepLevel,
  direction: 1 | -1,
): ScanBeepLevel {
  const next = levelIndex(current) + direction
  if (next < 0 || next >= SCAN_BEEP_LEVELS.length) {
    return current
  }
  return SCAN_BEEP_LEVELS[next].id
}

export function scanBeepLabel(level: ScanBeepLevel): string {
  return SCAN_BEEP_LEVELS[levelIndex(level)].label
}

export function scanBeepAmplitude(level: ScanBeepLevel): number {
  return SCAN_BEEP_LEVELS[levelIndex(level)].amplitude
}
