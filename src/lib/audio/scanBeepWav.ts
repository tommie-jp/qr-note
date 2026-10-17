// スキャンの読み取り音 (docs/112-スキャン音量計画.md)。
//
// 読み取りライブラリ (@yudiel/react-qr-scanner) は既定で内蔵のビープ (mp3) を
// `new Audio()` で鳴らす。その Audio は外から触れず、触れたとしても
// **iOS は HTMLMediaElement の volume を JS から変えられない** (常に 1)。
// そこで音量を**波形の振幅に焼き込んだ** WAV を段ごとに作り、ライブラリの
// `sound` (URL / data URI を受ける) に渡す。再生の経路はライブラリのまま
// なので、iPhone での鳴り方 (メディア音量に乗る・消音スイッチでも鳴る) は
// 変わらず、大きさだけが変わる。
//
// Web Audio (GainNode) にしない理由も docs/112 に置いた。消音スイッチで黙る
// ようになり、AudioContext の解錠を開く導線ごとに仕込む手間が増える。
//
// 音は正弦波 1 つ。スマホのスピーカーは 1 kHz 以下が弱いので高めの C7
// (2093 Hz) にし、頭と尻に短い傾斜を付けてプチ音を消す。16bit / モノラル /
// 22.05 kHz / 80 ms で約 3.5 KB (data URI で約 4.7 KB)。ソースに巨大な
// base64 を埋めず、実行時に組み立てる。

const SAMPLE_RATE = 22_050
const DURATION_MS = 80
const FREQUENCY_HZ = 2093
const ATTACK_MS = 5
const RELEASE_MS = 30
const WAV_HEADER_BYTES = 44
const BYTES_PER_SAMPLE = 2
const PCM16_MAX = 32_767

export const SCAN_BEEP_SAMPLE_COUNT = Math.round(
  (SAMPLE_RATE * DURATION_MS) / 1000,
)

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}

// 頭は ATTACK_MS で 0 → 1、尻は RELEASE_MS で 1 → 0 の直線
function envelope(index: number): number {
  const attack = (SAMPLE_RATE * ATTACK_MS) / 1000
  const release = (SAMPLE_RATE * RELEASE_MS) / 1000
  const fromEnd = SCAN_BEEP_SAMPLE_COUNT - 1 - index
  return Math.min(1, index / attack, fromEnd / release)
}

// amplitude は 0〜1 (prefs/scanBeepVolume.ts の段の振幅)。範囲外は端へ寄せる
export function buildScanBeepWavBytes(amplitude: number): Uint8Array<ArrayBuffer> {
  const gain = Math.min(1, Math.max(0, amplitude))
  const dataLength = SCAN_BEEP_SAMPLE_COUNT * BYTES_PER_SAMPLE
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataLength)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt チャンクの長さ
  view.setUint16(20, 1, true) // 非圧縮 PCM
  view.setUint16(22, 1, true) // モノラル
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * BYTES_PER_SAMPLE, true) // 1 秒あたりのバイト数
  view.setUint16(32, BYTES_PER_SAMPLE, true) // ブロックの大きさ
  view.setUint16(34, 16, true) // 1 標本のビット数
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataLength, true)
  for (let i = 0; i < SCAN_BEEP_SAMPLE_COUNT; i += 1) {
    const phase = (2 * Math.PI * FREQUENCY_HZ * i) / SAMPLE_RATE
    const sample = Math.sin(phase) * envelope(i) * gain
    view.setInt16(
      WAV_HEADER_BYTES + i * BYTES_PER_SAMPLE,
      Math.round(sample * PCM16_MAX),
      true,
    )
  }
  return new Uint8Array(buffer)
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

// 段ごとに 1 度だけ作る。ライブラリは sound の文字列が変わると Audio を
// 作り直すので、同じ段なら同じ文字列を返す (描画のたびに組み立て直さない)
const cache = new Map<number, string>()

export function scanBeepDataUri(amplitude: number): string {
  const cached = cache.get(amplitude)
  if (cached !== undefined) {
    return cached
  }
  const uri = `data:audio/wav;base64,${toBase64(buildScanBeepWavBytes(amplitude))}`
  cache.set(amplitude, uri)
  return uri
}
