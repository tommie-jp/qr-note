// 読み上げ 1 回ぶんの試行 (utterance 1 つ) と、その見張り (docs/81-単語TTS発音計画.md)。
// やり直し・停止・「この端末では声を指定しない」の覚え書きといった
// セッションの状態は持たない — それは speak.ts の仕事で、ここは知らせる口
// (AttemptHandlers) を呼ぶだけにする。
//
// **実機の失敗は /logs から読む** (docs/30-ブラウザログ計画.md)。iPhone は
// Mac 無しでインスペクタを繋げないので、選んだ声と鳴らなかった事実を
// 診断ログに残す。console には出さない (失敗ではないものを警告にしない)。

import { logDiagEvent } from '@/lib/diagLog'
import {
  TTS_GIVEUP_MS,
  TTS_LANG,
  TTS_RATE,
  TTS_START_TIMEOUT_MS,
} from './config'
import { describeVoice } from './voices'

interface SpeechGlobals {
  speechSynthesis?: SpeechSynthesis
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance
}

export interface SpeechApi {
  synth: SpeechSynthesis
  Utterance: typeof SpeechSynthesisUtterance
}

// ブラウザの API を取り出す。サーバ描画・非対応ブラウザでは null。
// **globalThis から都度読む** — モジュールの読み込み時に触ると、
// サーバ側 (Server Component の束) で ReferenceError になる
export function speechApi(): SpeechApi | null {
  const globals = globalThis as SpeechGlobals
  if (!globals.speechSynthesis || !globals.SpeechSynthesisUtterance) {
    return null
  }
  return {
    synth: globals.speechSynthesis,
    Utterance: globals.SpeechSynthesisUtterance,
  }
}

// 読み上げが終わったときの知らせ。spoke = 実際に音が出たか
export type TtsEndHandler = (spoke: boolean) => void

// 止めたときに飛ぶ error。端末の不調ではないので「鳴らなかった」とは言わない
const CANCEL_ERRORS = new Set(['canceled', 'interrupted'])

// 抱えているときだけ止める。**鳴っていないのに cancel() を呼ぶと、直後の
// speak() が巻き込まれて無音になる端末がある** (iOS。docs/81 §6-2)。
// 判断を散らさないよう、止める口はこの 1 つにまとめる
export function cancelIfBusy(synth: SpeechSynthesis): void {
  if (synth.speaking || synth.pending) {
    synth.cancel()
  }
}

// 1 回ぶんの試行 (utterance 1 つ) の取っ手。
//
// **やり直す前・終わった後は abandon で畳む。** 見張り (setTimeout) と
// utterance のハンドラを持ち主のいないまま残すと、声を外したやり直しが
// 正しく鳴った数秒後に 1 回目の打ち切りが「鳴らなかった」と言い出し、
// 抱えていた utterance が遅れて鳴れば onend まで二重に飛ぶ
export interface SpeechAttempt {
  abandon: () => void
}

// 試行から呼ぶ側への知らせ。
export interface AttemptHandlers {
  // 終わり (成功・失敗) を伝える口。
  // **1 度しか通らないことを呼ぶ側 (speakEnglish) が保証している。**
  settle: TtsEndHandler
  // 「speak したのに鳴り始めない」ときに呼ぶ。
  onNotStarted: () => void
  // 声の代入を端末に断られたときに呼ぶ。以後は声を指定しない、と
  // 覚えるのは呼ぶ側 (セッションの状態は speak.ts が持つ)
  onVoiceRejected: () => void
}

// 1 回ぶんの読み上げ。
export function speakOnce(
  api: SpeechApi,
  text: string,
  voice: SpeechSynthesisVoice | null,
  handlers: AttemptHandlers,
): SpeechAttempt {
  const { synth, Utterance } = api
  const { settle, onNotStarted, onVoiceRejected } = handlers
  const utterance = new Utterance(text)
  utterance.lang = TTS_LANG
  utterance.rate = TTS_RATE

  // **鳴り始めたかを見張る。** speak() が受け付けられても音が出ないこと
  // (使えない声を指定した・OS 側に弾かれた) があり、その場合 onend も
  // onerror も飛ばないので、待つ以外に気づく手が無い。
  //
  // ただし**エンジンが抱えている (speaking/pending) 間は横取りしない** —
  // iOS は最初の 1 回の立ち上がりが遅いことがあり、そこで割り込むと
  // 二重に読み上げる。抱えたまま黙っているときだけ「鳴らなかった」と見なす
  const startedAt = Date.now()
  const since = () => Date.now() - startedAt
  let started = false
  // この試行がまだ当てにされているか。やり直し・停止・打ち切りで false になる。
  // clearTimeout だけでは、いま走っている見張りの中から畳んだ場合を防げない
  let live = true

  // この試行を畳む。**ハンドラも外す** — 諦めた utterance が後から鳴り出して
  // onstart / onend を飛ばしてくることがあり (iOS)、そのまま繋がっていると
  // 鳴っている途中でボタンが idle に戻ってしまう
  const abandon = () => {
    live = false
    clearTimeout(startTimer)
    clearTimeout(giveUpTimer)
    utterance.onstart = null
    utterance.onend = null
    utterance.onerror = null
  }

  const startTimer = setTimeout(() => {
    if (!live || started) {
      return
    }
    const busy = synth.speaking || synth.pending
    logDiagEvent(
      `[発音] ${TTS_START_TIMEOUT_MS}ms 無反応 (speaking=${synth.speaking} ` +
        `pending=${synth.pending}) 声=${describeVoice(voice)}`,
    )
    if (busy) {
      // エンジンは持っている。二重読みを避けてこのまま待つ
      return
    }
    onNotStarted()
  }, TTS_START_TIMEOUT_MS)

  // 抱えたまま鳴り始めない場合の打ち切り。ここまで来ても onstart が無ければ
  // 何も起きていないので、押した見た目を戻して理由を出す
  const giveUpTimer = setTimeout(() => {
    if (!live || started) {
      return
    }
    logDiagEvent(`[発音] ${TTS_GIVEUP_MS}ms 待っても鳴り始めない`)
    // **抱えたままの utterance を engine から降ろす。** 残すと、諦めて idle に
    // 戻したボタンの後ろで鳴り出し (そのボタンでは止められない)、onend が
    // 「読み終えた」と二重に知らせに来る。
    // 先にハンドラを外してから止める — cancel の error を「中断」として
    // 拾うと、失敗ではなく成功で畳んでしまう
    abandon()
    cancelIfBusy(synth)
    settle(false)
  }, TTS_GIVEUP_MS)

  utterance.onstart = () => {
    started = true
    clearTimeout(startTimer)
    clearTimeout(giveUpTimer)
    logDiagEvent(`[発音] 鳴り始めた +${since()}ms 声=${describeVoice(voice)}`)
  }
  utterance.onend = () => {
    logDiagEvent(`[発音] 読み終えた +${since()}ms (始まり検知=${started})`)
    settle(true)
  }
  utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
    // cancel() で止めたときも error ('canceled' / 'interrupted') が飛ぶ。
    // これは利用者が止めただけなので、鳴らなかったとは言わない
    const error = event?.error ?? '不明'
    const stopped = CANCEL_ERRORS.has(error)
    logDiagEvent(`[発音] 中断 (${error}) +${since()}ms 声=${describeVoice(voice)}`)
    settle(stopped)
  }

  // **声の代入は投げることがある。** 一覧から取った声でも、ブラウザが
  // 「変換できない」として TypeError を出す端末がある (実測)。素で書くと
  // 例外が押下ハンドラまで抜けて、音も出ず・知らせも出ず・見張りも動かない
  // — 「押しても何も起きない」の正体になる。声だけ諦めて lang で鳴らす
  if (voice !== null) {
    try {
      utterance.voice = voice
    } catch (e) {
      onVoiceRejected()
      logDiagEvent(`[発音] 声を設定できない (${describeVoice(voice)}): ${String(e)}`)
    }
  }

  // **同期で speak すること。** iOS は最初の 1 回を「ユーザー操作の中」で
  // 呼ぶことを求めるので、ここに setTimeout を挟むと黙って捨てられる。
  // cancel() との競合を避けて待ちを入れる手もあるが、待ちの害のほうが大きい
  try {
    cancelIfBusy(synth)
    synth.speak(utterance)
  } catch (e) {
    // speak 自体が投げたら、見張りを待たずにその場で知らせる
    abandon()
    logDiagEvent(`[発音] speak が失敗した: ${String(e)}`)
    onNotStarted()
  }

  return { abandon }
}
