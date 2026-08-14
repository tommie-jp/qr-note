// 英単語・例文の読み上げ (docs/81-単語TTS発音計画.md)。
// ブラウザ内蔵の Web Speech API を使う — iPhone では OS の音声合成
// (AVSpeechSynthesizer と同じもの) がそのまま鳴るので、通信もモデルも要らず
// オフラインでも動く。
//
// **いちばんの罠は声を指定しないこと。** 日本語設定の iPhone で lang / voice を
// 与えずに speak() すると、既定の日本語の声 (Kyoko) が英語を読んでカタカナ
// 発音になる。「iPhone の TTS は使えない」と言われるものの大半はこれなので、
// 英語の声を自分で選ぶところがこのモジュールの本体。
//
// SSML も発音記号 (IPA) 指定も Safari は受け付けないため、読ませ方を細かく
// 指示する手段は無い。渡せるのは綴り・言語・速さだけ。
//
// **実機の失敗は /logs から読む** (docs/30-ブラウザログ計画.md)。iPhone は
// Mac 無しでインスペクタを繋げないので、選んだ声と鳴らなかった事実を
// 診断ログに残す。console には出さない (失敗ではないものを警告にしない)。

import { logDiagEvent } from './diagLog'

// 単語も例文も US 発音で統一する (英語学習の目標発音)
export const TTS_LANG = 'en-US'

// 少しだけ遅くする。既定 (1.0) は単語の聞き取りには速い
export const TTS_RATE = 0.9

// speak() してから鳴り始めるまでを待つ上限。過ぎたら声を外して 1 度だけ
// 試し直す (speakOnce に理由)。長すぎると押してから無反応の時間が伸び、
// 短すぎると鳴り始めた声に二重で被せるので、その間を取る
export const TTS_START_TIMEOUT_MS = 1200

// 優先して選ぶ声。Apple の自然な英語 (US) 音声を先に、その後 PC ブラウザの
// 標準的な英語音声を並べる。
//
// **Ava / Zoe が先頭なのは意図的** — どちらも「設定 > アクセシビリティ >
// 読み上げコンテンツ > 声」から追加ダウンロードする高品質版で、一覧に居る
// = 利用者が入れたということ。入っていなければ iOS に必ずある Samantha に落ちる
const PREFERRED_VOICE_NAMES = [
  'Ava',
  'Zoe',
  'Samantha',
  'Allison',
  'Susan',
  'Evan',
  'Nathan',
  'Joelle',
  'Nicky',
  'Aaron',
  'Google US English',
  'Microsoft Aria',
  'Microsoft Jenny',
  'Microsoft Zira',
]

// 選んではいけない声。Apple の英語一覧には効果音のような声と旧世代の声が
// 混ざっており、**名前順で先頭に近い** (Albert / Bad News / Bahh…)。
// 上の優先名に当たらなかったときの受け皿が、これを弾かないと最悪になる
const NOVELTY_VOICE_NAMES = new Set([
  'Albert',
  'Bad News',
  'Bahh',
  'Bells',
  'Boing',
  'Bubbles',
  'Cellos',
  'Fred',
  'Good News',
  'Grandma',
  'Grandpa',
  'Jester',
  'Junior',
  'Kathy',
  'Organ',
  'Ralph',
  'Rocko',
  'Superstar',
  'Trinoids',
  'Whisper',
  'Wobble',
  'Zarvox',
])

interface SpeechGlobals {
  speechSynthesis?: SpeechSynthesis
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance
}

// ブラウザの API を取り出す。サーバ描画・非対応ブラウザでは null。
// **globalThis から都度読む** — モジュールの読み込み時に触ると、
// サーバ側 (Server Component の束) で ReferenceError になる
function speechApi(): {
  synth: SpeechSynthesis
  Utterance: typeof SpeechSynthesisUtterance
} | null {
  const globals = globalThis as SpeechGlobals
  if (!globals.speechSynthesis || !globals.SpeechSynthesisUtterance) {
    return null
  }
  return {
    synth: globals.speechSynthesis,
    Utterance: globals.SpeechSynthesisUtterance,
  }
}

// Android は en_US、Apple は en-US と書く。大小も揃えてから比べる
function normalizeLang(lang: string): string {
  return lang.replace('_', '-').toLowerCase()
}

// 読み上げに使う英語の声を選ぶ。無ければ null (lang 指定だけで鳴らす)。
export function pickEnglishVoice(
  voices: readonly SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => normalizeLang(v.lang).startsWith('en'))
  if (english.length === 0) {
    return null
  }
  // US があれば US だけから選ぶ。無ければ他の英語で代用する
  const us = english.filter((v) => normalizeLang(v.lang) === 'en-us')
  const pool = us.length > 0 ? us : english

  for (const name of PREFERRED_VOICE_NAMES) {
    const hit =
      pool.find((v) => v.name === name) ??
      pool.find((v) => v.name.includes(name))
    if (hit !== undefined) {
      return hit
    }
  }

  // 名前で当てられなかったときの受け皿。効果音のような声だけは避けるが、
  // それしか無ければ鳴らす — 無音にするより読み上げるほうがましなので
  return pool.find((v) => !NOVELTY_VOICE_NAMES.has(v.name)) ?? pool[0]
}

// 声の一覧を先に読み込ませる。
//
// iOS / Chrome の getVoices() は**初回に空の配列を返す**ことがあり、埋まるのは
// 非同期に voiceschanged が飛んだ後。一度呼んでおくと読み込みが始まるので、
// 最初の 1 押しから英語の声で鳴る。呼べなくても実害は無い (lang だけで鳴る)
export function primeVoices(): void {
  speechApi()?.synth.getVoices()
}

// 声の名前を 1 行にする (診断ログ用)
function describeVoice(voice: SpeechSynthesisVoice | null): string {
  return voice === null ? 'なし(langのみ)' : `${voice.name}/${voice.lang}`
}

// 1 ページにつき 1 度だけ、選んだ声を /logs に残す。毎回送るとログが
// 発音だけで埋まる (logEnvironmentOnce と同じ判断)
let choiceLogged = false

// この端末では声を指定すると鳴らない、と判った後は指定をやめる。
// 一度でも「鳴り始めない → 声を外したら鳴った」を踏んだら立てる。
// 立てないと、押すたびに 1.2 秒待ってから鳴ることになる
let skipVoice = false

interface SpeechApi {
  synth: SpeechSynthesis
  Utterance: typeof SpeechSynthesisUtterance
}

// 読み上げが終わったときの知らせ。spoke = 実際に音が出たか
export type TtsEndHandler = (spoke: boolean) => void

// 止めたときに飛ぶ error。端末の不調ではないので「鳴らなかった」とは言わない
const CANCEL_ERRORS = new Set(['canceled', 'interrupted'])

// 1 回ぶんの読み上げ。onNotStarted は「speak したのに鳴り始めない」ときに呼ぶ。
function speakOnce(
  api: SpeechApi,
  text: string,
  voice: SpeechSynthesisVoice | null,
  onEnd: TtsEndHandler | undefined,
  onNotStarted: () => void,
): void {
  const { synth, Utterance } = api
  const utterance = new Utterance(text)
  utterance.lang = TTS_LANG
  utterance.rate = TTS_RATE

  // **鳴り始めたかを見張る。** speak() が受け付けられても音が出ないこと
  // (使えない声を指定した・OS 側に弾かれた) があり、その場合 onend も
  // onerror も飛ばないので、待つ以外に気づく手が無い
  let started = false
  const timer = setTimeout(() => {
    if (!started) {
      onNotStarted()
    }
  }, TTS_START_TIMEOUT_MS)
  const settle = () => {
    started = true
    clearTimeout(timer)
  }

  utterance.onstart = settle
  utterance.onend = () => {
    settle()
    onEnd?.(true)
  }
  utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
    settle()
    // cancel() で止めたときも error ('canceled' / 'interrupted') が飛ぶ。
    // これは利用者が止めただけなので、鳴らなかったとは言わない
    const error = event?.error ?? '不明'
    const stopped = CANCEL_ERRORS.has(error)
    if (!stopped) {
      logDiagEvent(`[発音] 失敗 (${error}) 声=${describeVoice(voice)}`)
    }
    onEnd?.(stopped)
  }

  // **声の代入は投げることがある。** 一覧から取った声でも、ブラウザが
  // 「変換できない」として TypeError を出す端末がある (実測)。素で書くと
  // 例外が押下ハンドラまで抜けて、音も出ず・知らせも出ず・見張りも動かない
  // — 「押しても何も起きない」の正体になる。声だけ諦めて lang で鳴らす
  if (voice !== null) {
    try {
      utterance.voice = voice
    } catch (e) {
      skipVoice = true
      logDiagEvent(`[発音] 声を設定できない (${describeVoice(voice)}): ${String(e)}`)
    }
  }

  // **同期で speak すること。** iOS は最初の 1 回を「ユーザー操作の中」で
  // 呼ぶことを求めるので、ここに setTimeout を挟むと黙って捨てられる。
  // cancel() との競合を避けて待ちを入れる手もあるが、待ちの害のほうが大きい
  try {
    if (synth.speaking || synth.pending) {
      synth.cancel()
    }
    synth.speak(utterance)
  } catch (e) {
    // speak 自体が投げたら、見張りを待たずにその場で知らせる
    settle()
    logDiagEvent(`[発音] speak が失敗した: ${String(e)}`)
    onNotStarted()
  }
}

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
  const voices = api.synth.getVoices()
  const voice = skipVoice ? null : pickEnglishVoice(voices)
  if (!choiceLogged) {
    choiceLogged = true
    logDiagEvent(
      `[発音] 声=${describeVoice(voice)} 候補=${voices.length} ` +
        `英語=${voices.filter((v) => v.lang.toLowerCase().startsWith('en')).length}`,
    )
  }

  speakOnce(api, text, voice, onEnd, () => {
    logDiagEvent(
      `[発音] ${TTS_START_TIMEOUT_MS}ms 鳴り始めない (${describeVoice(voice)}) → 声を外して再試行`,
    )
    // 次からは最初から声を外す (毎回 1.2 秒待たせない)
    skipVoice = true
    speakOnce(api, text, null, onEnd, () => {
      logDiagEvent('[発音] 声を外しても鳴らなかった')
      onEnd?.(false)
    })
  })
  return true
}

// 読み上げを止める。鳴っていなければ何もしない
export function stopSpeaking(): void {
  const api = speechApi()
  if (api !== null && (api.synth.speaking || api.synth.pending)) {
    api.synth.cancel()
  }
}
