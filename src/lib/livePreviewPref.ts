// ライブプレビューの ON/OFF を端末に覚える (docs/70-編集ライブプレビュー計画.md §4)。
//
// **ノート単位ではなく端末単位**にする。記法を隠して読みたい人はどのノートでも
// 隠したいはずで、ノートごとに覚えると開くたびに表示が変わって落ち着かない。
//
// memoDraft.ts と同じ流儀で、Storage は引数で受ける純関数だけを置く
// (effect の結線は MemoEditorInner 側)。

// localStorage は全部は要らないので、使う分だけの形で受ける (テスト容易性)
export type LivePreviewStorage = Pick<Storage, 'getItem' | 'setItem'>

export const LIVE_PREVIEW_STORAGE_KEY = 'qr-search:live-preview'

// **既定は ON**。日本語 IME での挙動を確かめてから切り替えた
// (デスクトップ Chromium は CDP の合成イベントで、iPhone は実機で。計画 §8)。
//
// 一度でも切り替えた端末は保存値が優先されるので、OFF にしてある端末が
// 勝手に ON へ戻ることはない (parseLivePreviewPref は '0' を尊重する)
export const LIVE_PREVIEW_DEFAULT = true

// 保存されていない・読めない・知らない値はすべて既定に倒す
// (localStorage は外部入力として扱う)
export function parseLivePreviewPref(raw: string | null): boolean {
  if (raw === '1') {
    return true
  }
  if (raw === '0') {
    return false
  }
  return LIVE_PREVIEW_DEFAULT
}

export function loadLivePreviewPref(storage: LivePreviewStorage): boolean {
  try {
    return parseLivePreviewPref(storage.getItem(LIVE_PREVIEW_STORAGE_KEY))
  } catch {
    // プライベートモード等で読めない環境では既定で動く (設定は保険であって
    // 本筋ではない。編集そのものは従来どおりできる)
    return LIVE_PREVIEW_DEFAULT
  }
}

export function saveLivePreviewPref(
  storage: LivePreviewStorage,
  enabled: boolean,
): void {
  try {
    storage.setItem(LIVE_PREVIEW_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // 書けなくてもその場の切り替えは効いている (次に開くと既定に戻るだけ)
  }
}
