// 英単語・例文の読み上げの設定値 (docs/81-単語TTS発音計画.md)。
// speechSynthesis に触らない定数だけの葉なので、UI やテストはここだけを
// import しても読み上げ本体 (voices.ts・attempt.ts・speak.ts) を引き込まない。

// 単語も例文も US 発音で統一する (英語学習の目標発音)
export const TTS_LANG = 'en-US'

// 少しだけ遅くする。既定 (1.0) は単語の聞き取りには速い
export const TTS_RATE = 0.9

// speak() してから鳴り始めるまでを待つ上限。過ぎたら声を外して 1 度だけ
// 試し直す (attempt.ts の speakOnce に理由)。長すぎると押してから無反応の時間が伸び、
// 短すぎると鳴り始めた声に二重で被せるので、その間を取る
export const TTS_START_TIMEOUT_MS = 1200

// エンジンが抱えたまま鳴り始めないときの打ち切り。押した見た目を戻して
// 理由を出すためだけの上限で、ここまで onstart が無ければ何も起きていない
export const TTS_GIVEUP_MS = 8000
