// 読み上げに使う英語の声を選ぶ純関数 (docs/81-単語TTS発音計画.md)。
// speechSynthesis には触らず、渡された声の一覧だけを見る。
//
// **いちばんの罠は声を指定しないこと。** 日本語設定の iPhone で lang / voice を
// 与えずに speak() すると、既定の日本語の声 (Kyoko) が英語を読んでカタカナ
// 発音になる。「iPhone の TTS は使えない」と言われるものの大半はこれなので、
// 英語の声を自分で選ぶところが読み上げ (tts/) の本体。

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

// 声の名前を 1 行にする (診断ログ用)
export function describeVoice(voice: SpeechSynthesisVoice | null): string {
  return voice === null ? 'なし(langのみ)' : `${voice.name}/${voice.lang}`
}
