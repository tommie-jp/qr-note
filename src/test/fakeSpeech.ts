// 読み上げ (src/lib/tts/) のテスト用に、ブラウザの Web Speech API を差し込む
// 最小の作り物。vitest は node 環境なので speechSynthesis も
// SpeechSynthesisUtterance も無い

import { vi } from 'vitest'

export const voice = (name: string, lang: string) =>
  ({ name, lang }) as SpeechSynthesisVoice

export class FakeUtterance {
  lang = ''
  rate = 1
  voice: SpeechSynthesisVoice | null = null
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { error?: string }) => void) | null = null
  constructor(public text: string) {}
}

// 声を代入しようとすると投げる端末の作り物。voice は**アクセサ**にする
// (クラスフィールドにすると構築時の初期化で自分の setter を踏む)
export class VoiceRejectingUtterance {
  lang = ''
  rate = 1
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { error?: string }) => void) | null = null
  constructor(public text: string) {}
  set voice(_value: SpeechSynthesisVoice | null) {
    throw new TypeError('Failed to convert value to SpeechSynthesisVoice')
  }
  get voice(): SpeechSynthesisVoice | null {
    return null
  }
}

export interface FakeSynth {
  speaking: boolean
  pending: boolean
  cancel: ReturnType<typeof vi.fn>
  speak: ReturnType<typeof vi.fn>
  getVoices: () => SpeechSynthesisVoice[]
}

export function installSpeech(
  voices: SpeechSynthesisVoice[],
  speaking = false,
): FakeSynth {
  const synth: FakeSynth = {
    speaking,
    pending: false,
    cancel: vi.fn(),
    speak: vi.fn(),
    getVoices: () => voices,
  }
  Object.assign(globalThis, {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: FakeUtterance,
  })
  return synth
}

// afterEach で呼ぶ。差し込んだ API をテスト間で持ち越さない
export function uninstallSpeech(): void {
  Reflect.deleteProperty(globalThis, 'speechSynthesis')
  Reflect.deleteProperty(globalThis, 'SpeechSynthesisUtterance')
}
