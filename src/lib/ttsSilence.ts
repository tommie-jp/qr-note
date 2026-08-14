// 読み上げが聞こえないときに何と言うか (docs/81-単語TTS発音計画.md §6-1-2)。
//
// **消音かどうかは判定できない。** 消音スイッチも着信音量も iOS は公開して
// いないうえ、**消音のときも `onstart` / `onend` は正常に飛ぶ**。実機で
// 比べても区別が付かなかった (計画 §6-1-4):
//
//   消音で無音: 鳴り始めた +2ms / 読み終えた +1080ms
//   着信音あり: 鳴り始めた +9ms / 読み終えた +1051ms
//
// そこで**判定をあきらめ、鳴らしたつもりの回に直し方を添える**。iPhone /
// iPad で真っ先に疑うべきは音量の設定 — 読み上げは動画や音楽のメディア音量
// ではなく**着信音量**で鳴り、消音スイッチでも黙るため、「他の音は出ている
// のに読み上げだけ無音」という自力では気づきにくい形になる。
//
// 聞こえている人には無用なので、**消せる**ようにして端末に覚える
// (livePreviewPref.ts と同じ流儀で、Storage は引数で受ける純関数にする)。

// iOS / iPadOS か。**iPad は UA が Macintosh を名乗る** (13 以降) ので、
// 触れる画面かどうかで見分ける。外したときの症状は文面が一般的になるだけ
export function isAppleTouchDevice(
  nav: unknown = typeof navigator !== 'undefined' ? navigator : undefined,
): boolean {
  const n = nav as { userAgent?: string; maxTouchPoints?: number } | undefined
  const ua = n?.userAgent ?? ''
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return true
  }
  return /Macintosh/i.test(ua) && (n?.maxTouchPoints ?? 0) > 1
}

// Apple 端末向けの文面。**「消音スイッチ」と「着信音量」の両方**を言う —
// 片方だけ直しても鳴らないので、どちらかだけ書くと直したのに鳴らないという
// 最悪の空振りになる
export const TTS_SILENT_APPLE_MESSAGE =
  '音が出ません。消音モードを解除し、着信音量を上げてください (読み上げはメディア音量ではなく着信音量で鳴ります)'

// それ以外の端末。原因を当てられないので、断定せずに事実だけ言う
export const TTS_SILENT_GENERIC_MESSAGE =
  '音が出ませんでした。端末の音量と消音の設定を確認してください'

// 鳴らなかったときに出す文面を選ぶ。
export function ttsSilenceMessage(nav?: unknown): string {
  return isAppleTouchDevice(nav)
    ? TTS_SILENT_APPLE_MESSAGE
    : TTS_SILENT_GENERIC_MESSAGE
}

// 鳴らしたつもりの回に添える案内。**「聞こえない」を仮定しない書き方**にする
// — 実際には聞こえている人にも出るので、断定すると毎回うるさい
export const TTS_SILENT_HINT =
  '聞こえないときは、消音モードを解除して着信音量を上げてください (読み上げはメディア音量ではなく着信音量で鳴ります)'

// localStorage は全部は要らないので、使う分だけの形で受ける (テスト容易性)
export type TtsHintStorage = Pick<Storage, 'getItem' | 'setItem'>

export const TTS_HINT_STORAGE_KEY = 'qr-search:tts-hint'

// 案内を消したか。**端末単位**で覚える — 音量の設定は端末のものなので、
// ノートごとに覚え直させる意味がない (livePreviewPref と同じ判断)
export function isTtsHintDismissed(storage: TtsHintStorage): boolean {
  try {
    return storage.getItem(TTS_HINT_STORAGE_KEY) === '1'
  } catch {
    // プライベートモード等で読めない環境では出し続ける。案内は保険なので、
    // 読めないことを理由に黙るより、うるさいほうがまだよい
    return false
  }
}

export function dismissTtsHint(storage: TtsHintStorage): void {
  try {
    storage.setItem(TTS_HINT_STORAGE_KEY, '1')
  } catch {
    // 書けなくてもその場では消えている (次に開くとまた出るだけ)
  }
}

// いま案内を出すか。Apple 端末だけに出す — 着信音量で鳴るのは iOS の作法で、
// PC と Android には当てはまらない (的外れな案内は害になる)
export function shouldShowTtsHint(
  storage: TtsHintStorage,
  nav?: unknown,
): boolean {
  return isAppleTouchDevice(nav) && !isTtsHintDismissed(storage)
}
