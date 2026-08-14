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

// 単語も例文も US 発音で統一する (英語学習の目標発音)
export const TTS_LANG = 'en-US'

// 少しだけ遅くする。既定 (1.0) は単語の聞き取りには速い
export const TTS_RATE = 0.9

// 鳴っている物を止めてから読み直すまでの待ち (speakEnglish の末尾に理由)
export const RESPEAK_DELAY_MS = 100

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

// 英語として読み上げる。対応していない端末では false を返す
// (呼ぶ側が「この端末では読み上げできません」と出せるように、黙って捨てない)。
//
// onEnd は読み終わり・失敗のどちらでも呼ぶ。押した見た目のまま固まらせない
export function speakEnglish(text: string, onEnd?: () => void): boolean {
  const api = speechApi()
  if (api === null) {
    return false
  }
  const { synth, Utterance } = api
  const utterance = new Utterance(text)
  utterance.lang = TTS_LANG
  utterance.rate = TTS_RATE
  const voice = pickEnglishVoice(synth.getVoices())
  if (voice !== null) {
    utterance.voice = voice
  }
  if (onEnd !== undefined) {
    utterance.onend = () => onEnd()
    utterance.onerror = () => onEnd()
  }

  // 鳴っていなければ**同期のまま** speak する。iOS は最初の 1 回を
  // 「ユーザー操作の中」で呼ぶことを求めるので、ここに待ちを挟まない
  if (!synth.speaking && !synth.pending) {
    synth.speak(utterance)
    return true
  }

  // 鳴っている物を止めて読み直すときだけ、ひと呼吸置く。cancel() は非同期に
  // 効くので、直後に渡した utterance が巻き込まれて無音のまま終わる端末が
  // ある (押した見た目のまま固まる)。ここに来る時点で既に 1 回鳴っており、
  // 操作の中で呼ぶ制限は満たしているので待ってよい
  synth.cancel()
  setTimeout(() => synth.speak(utterance), RESPEAK_DELAY_MS)
  return true
}

// 読み上げを止める。鳴っていなければ何もしない
export function stopSpeaking(): void {
  const api = speechApi()
  if (api !== null && (api.synth.speaking || api.synth.pending)) {
    api.synth.cancel()
  }
}
