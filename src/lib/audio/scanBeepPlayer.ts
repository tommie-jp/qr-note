// スキャンの読み取り音を鳴らす (docs/112-スキャン音量計画.md §2-4)。
//
// **ライブラリに鳴らさせない。** @yudiel/react-qr-scanner の `sound` は、
// 読めた瞬間に play() してすぐ onScan を呼ぶ。こちらは onScan でモーダルを
// 閉じるので、ライブラリの後始末 (useEffect の cleanup) が直後に pause() する。
// iPhone は play() から音が出るまでに間があり、その間に止められてほぼ鳴らない
// (v0.23.45 の実機で「鳴ったり鳴らなかったり、殆どならない」)。
//
// そこで要素を**モジュールに 1 つだけ**持ち、モーダルより長生きさせる。
// 閉じても誰も pause しないので、鳴り始めた音は最後まで鳴る。
//
// 再生はユーザー操作の外 (読み取りの瞬間) だが、iOS Safari はカメラで
// 撮っている間のページに再生を許す。ライブラリの play() がたまに鳴っていた
// のもこのため。

import { logDiagEvent } from '@/lib/logging/diagLog'
import { scanBeepDataUri } from './scanBeepWav'

// play() の返事 (= 鳴り始めた) を待つ上限。ここまで待っても始まらなければ
// 閉じて遷移する。待ちすぎると読んでから画面が変わるまでが遅く感じる
export const SCAN_BEEP_START_WAIT_MS = 150

let element: HTMLAudioElement | null = null

// モーダルを開いたときに呼ぶ。振幅 0 (消音) なら要素を捨てて鳴らさない。
// 同じ音源なら作り直さない (開くたびに読み直さない)
export function prepareScanBeep(amplitude: number): void {
  if (typeof Audio === 'undefined') {
    return
  }
  if (amplitude <= 0) {
    element = null
    return
  }
  const src = scanBeepDataUri(amplitude)
  if (element?.src === src) {
    return
  }
  const audio = new Audio(src)
  audio.preload = 'auto'
  element = audio
}

// 読めたときに鳴らす。鳴り始めるか SCAN_BEEP_START_WAIT_MS が過ぎたら解決する。
// **失敗しても投げない** — 音は手応えであって本筋ではなく、鳴らなくても
// 遷移は進めたい。ただし黙って捨てず、理由を診断ログに残す
export function playScanBeep(): Promise<void> {
  const audio = element
  if (audio === null) {
    return Promise.resolve()
  }
  audio.currentTime = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SCAN_BEEP_START_WAIT_MS)
  })
  const started = Promise.resolve()
    .then(() => audio.play())
    .catch((error: unknown) => {
      logDiagEvent(`[スキャン音] 鳴らせなかった: ${String(error)}`)
    })
  return Promise.race([started, timeout]).finally(() => clearTimeout(timer))
}
