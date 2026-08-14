// 読み上げが鳴らなかったときに何と言うか (docs/81-単語TTS発音計画.md §6-1-2)。
//
// **消音スイッチも着信音量もブラウザからは読めない。** iOS はどちらも公開して
// いないので、「いま鳴らない設定になっている」を直接は判定できない。
//
// 代わりに使えるのは**鳴り始めたか** (`onstart`) だけ。実機の iPhone で
// 着信音を切っていたときは 1.2 秒経っても鳴り始めず、声を外して試し直しても
// 同じだった。つまり「speak は通ったのに始まらない」が、いまのところ唯一の
// 手掛かりになる。
//
// そこで、鳴らなかったと判ったときに**端末に合わせた直し方**を出す。
// iPhone / iPad なら真っ先に疑うべきは音量の設定 — 読み上げは動画や音楽の
// メディア音量ではなく**着信音量**で鳴り、消音スイッチでも黙るため、
// 「他の音は出ているのに読み上げだけ無音」という判りにくい形になる。

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
