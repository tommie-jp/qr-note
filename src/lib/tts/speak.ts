// 英単語・例文の読み上げ (docs/81-単語TTS発音計画.md)。
// ブラウザ内蔵の Web Speech API を使う — iPhone では OS の音声合成
// (AVSpeechSynthesizer と同じもの) がそのまま鳴るので、通信もモデルも要らず
// オフラインでも動く。
//
// SSML も発音記号 (IPA) 指定も Safari は受け付けないため、読ませ方を細かく
// 指示する手段は無い。渡せるのは綴り・言語・速さだけ。
//
// tts/ の層: 設定値 (config.ts) → 声の選択 (voices.ts、純関数) →
// 1 回ぶんの試行と見張り (attempt.ts) → このファイル (押下 1 回ぶんの
// セッションと、ページに 1 つの状態)。UI が触るのはこのファイルの 3 関数だけ。

import { logDiagEvent } from '@/lib/diagLog'
import {
  cancelIfBusy,
  speakOnce,
  speechApi,
  type SpeechAttempt,
  type TtsEndHandler,
} from './attempt'
import { TTS_START_TIMEOUT_MS } from './config'
import { describeVoice, pickEnglishVoice } from './voices'

// 声の一覧を先に読み込ませる。
//
// iOS / Chrome の getVoices() は**初回に空の配列を返す**ことがあり、埋まるのは
// 非同期に voiceschanged が飛んだ後。一度呼んでおくと読み込みが始まるので、
// 最初の 1 押しから英語の声で鳴る。呼べなくても実害は無い (lang だけで鳴る)
export function primeVoices(): void {
  speechApi()?.synth.getVoices()
}

// 1 ページにつき 1 度だけ、選んだ声を /logs に残す。毎回送るとログが
// 発音だけで埋まる (logEnvironmentOnce と同じ判断)
let choiceLogged = false

// この端末では声を指定すると鳴らない、と判った後は指定をやめる。
// 一度でも「鳴り始めない → 声を外したら鳴った」を踏んだら立てる。
// 立てないと、押すたびに 1.2 秒待ってから鳴ることになる
let skipVoice = false

// 声の代入を端末に断られたとき (attempt.ts の speakOnce) も同じく立てる
const skipVoiceFromNowOn = () => {
  skipVoice = true
}

// いま走らせている読み上げ 1 回ぶんの終わらせ方。停止 (stopSpeaking) と
// 次の読み上げの開始から、前の回を畳むために持つ。持たないと「押す前の回」の
// 打ち切りが後から失敗を知らせ、押していない行に警告が出る
let settleCurrent: TtsEndHandler | null = null

// 英語として読み上げる。対応していない端末では false を返す
// (呼ぶ側が「この端末では読み上げできません」と出せるように、黙って捨てない)。
//
// onEnd は読み終わり・失敗のどちらでも呼ぶ (押した見た目のまま固まらせない)。
// **引数は「音が出たか」** — 出なかったときに呼ぶ側が理由を画面に出せるように
// する。押しても何も起きない、が最も困る形なので、そこは必ず言葉にする。
//
// **鳴り始めなければ声を外してもう 1 回試す。** 一覧に載っていても実際には
// 鳴らせない声がある (iPhone だけ無音・iPad と PC は鳴る、という形で出た)。
// 声を外して lang だけにすると OS が既定の英語音声を選ぶので、そこまで
// 落ちれば鳴る
export function speakEnglish(text: string, onEnd?: TtsEndHandler): boolean {
  const api = speechApi()
  if (api === null) {
    logDiagEvent('[発音] この端末に speechSynthesis が無い')
    return false
  }

  // 前の回がまだ終わっていなければ、ここで畳む。下の speak() が cancel で
  // 前の声を止めるので、前の回は「止まった」= 失敗ではない (true) で終える
  settleCurrent?.(true)

  const voices = api.synth.getVoices()
  const voice = skipVoice ? null : pickEnglishVoice(voices)
  if (!choiceLogged) {
    choiceLogged = true
    logDiagEvent(
      `[発音] 声=${describeVoice(voice)} 候補=${voices.length} ` +
        `英語=${voices.filter((v) => v.lang.toLowerCase().startsWith('en')).length}`,
    )
  }

  // **終わりは 1 度だけ (settle once)。** 終わり方は 1.2 秒のやり直し・
  // 8 秒の打ち切り・onend・onerror・speak の例外・停止と多く、しかも
  // 試行が 2 つ並ぶので、通り道を 1 本に絞らないと知らせが二重に飛ぶ。
  // 飛ぶと「正しく鳴ったのに数秒後に失敗と出る」「鳴っている途中で
  // ボタンが idle に戻り、止められなくなる」になる (どちらも実際に起きた)
  let attempts: readonly SpeechAttempt[] = []
  let settled = false
  const settle: TtsEndHandler = (spoke) => {
    if (settled) {
      return
    }
    settled = true
    if (settleCurrent === settle) {
      settleCurrent = null
    }
    for (const attempt of attempts) {
      attempt.abandon()
    }
    onEnd?.(spoke)
  }
  settleCurrent = settle

  // 試行を控える。**取っ手を取りこぼさない** — 同期に失敗した試行 (speak が
  // 投げる端末) は自分の中でやり直しを始めるので、代入の順で上書きすると
  // やり直しの見張りが誰にも畳まれずに残る
  const register = (attempt: SpeechAttempt) => {
    attempts = [...attempts, attempt]
    if (settled) {
      attempt.abandon()
    }
  }

  // 鳴り始めなかったときのやり直し (声を外す)。
  const retryWithoutVoice = () => {
    logDiagEvent(
      `[発音] ${TTS_START_TIMEOUT_MS}ms 鳴り始めない (${describeVoice(voice)}) → 声を外して再試行`,
    )
    // 次からは最初から声を外す (毎回 1.2 秒待たせない)
    skipVoice = true
    // 1 回目はもう当てにしない。見張りとハンドラを外す。
    // **cancel はしない** — いま何も抱えていないから試し直しているのであり、
    // 鳴っていないのに cancel すると直後の speak が巻き込まれる (iOS)
    for (const attempt of attempts) {
      attempt.abandon()
    }
    register(
      speakOnce(api, text, null, {
        settle,
        onNotStarted: () => {
          logDiagEvent('[発音] 声を外しても鳴らなかった')
          settle(false)
        },
        onVoiceRejected: skipVoiceFromNowOn,
      }),
    )
  }

  register(
    speakOnce(api, text, voice, {
      settle,
      onNotStarted: retryWithoutVoice,
      onVoiceRejected: skipVoiceFromNowOn,
    }),
  )
  return true
}

// 読み上げを止める。鳴っていなければ音は止めない (iOS の作法) が、
// **走っている回は必ず畳む** — 鳴り始める前に止めたときは cancel も呼べず
// onerror も飛ばないので、見張りだけが残って数秒後に「鳴らなかった」と
// 言い出す。止めたのは利用者なので失敗ではない (spoke=true)
export function stopSpeaking(): void {
  const api = speechApi()
  if (api !== null) {
    cancelIfBusy(api.synth)
  }
  settleCurrent?.(true)
}
