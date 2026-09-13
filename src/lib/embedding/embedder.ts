// 画像 → 埋め込みベクトルの実体 (docs/25-画像検索計画.md §2,3)。
//
// transformers.js の image-feature-extraction をブラウザ・Node のどちらでも
// 同じコードで動かす。**同じモデル・同じ量子化を両側で使う**ことで、保存時
// (Node) に作ったベクトルとカメラ (ブラウザ) のベクトルが同じ空間に乗る。
//
// 重い依存 (transformers.js + モデル) はモジュール読み込みでは走らせず、
// 最初に embed() を呼んだときだけ動的 import で取り込む。以後は singleton。
//
// 注意: ブラウザ側は Web Worker から呼ぶ想定 (UI スレッドを塞がないため)。
// canvas / OffscreenCanvas / Blob をそのまま渡せる (RawImage.read が吸収する)。

import { EMBEDDING_DTYPE, EMBEDDING_MODEL_ID } from './model'
import { extractEmbedding, type TensorLike } from './extractEmbedding'
import { resolveDevice, type EmbeddingDevice } from './device'

// RawImage.read が受け付ける入力。ブラウザは canvas/Blob、Node は Blob を渡す。
export type EmbedInput =
  | Blob
  | HTMLCanvasElement
  | OffscreenCanvas
  | string
  | URL

// transformers.js の型は動的 import 側に閉じ込める (このモジュールを import
// しただけでライブラリ本体をバンドルに巻き込まないため)。
type Transformers = typeof import('@huggingface/transformers')
// pipeline() の返りは全タスクの共用体で「呼び出し可能」と型付かない。
// image-feature-extraction は画像を渡すとテンソルを返す関数として扱う。
type Extractor = (image: unknown) => Promise<TensorLike>

let libPromise: Promise<Transformers> | null = null
let extractorPromise: Promise<Extractor> | null = null
let ready = false
// どのデバイスで組もうとしたか。失敗を報せるとき「WebGPU で落ちたのか」を
// 呼び手が知る必要がある (WASM で作り直す価値があるかの判断材料)。
let attemptedDevice: EmbeddingDevice | 'unknown' = 'unknown'

// Node (サーバ・バックフィル) かどうか。Node 21+ はブラウザ互換の global
// navigator を持つため navigator の有無では判別できない。process.versions.node で
// 見る (Next.js のブラウザバンドルは process.env は生やすが versions は生やさない)。
function isNodeRuntime(): boolean {
  return (
    typeof process !== 'undefined' && process.versions?.node != null
  )
}

// WebGPU のアダプタが実際に取れるか。API の有無だけで決めてはいけない
// (WSL2 やソフトウェア描画の環境は navigator.gpu を生やしておきながらアダプタを
// 返さない)。判定の分岐そのものは device.ts の純関数に置く。
async function probeWebGpuAdapter(): Promise<boolean> {
  // TS の lib.dom はまだ navigator.gpu を持たないので、使う分だけ型を当てる
  // (@webgpu/types を足すほどの用ではない)
  type GpuLike = { requestAdapter: () => Promise<unknown> }
  const gpu =
    typeof navigator !== 'undefined'
      ? (navigator as Navigator & { gpu?: GpuLike }).gpu
      : undefined
  if (!gpu) {
    return false
  }
  try {
    return (await gpu.requestAdapter()) != null
  } catch {
    // アダプタ取得自体が投げる環境もある。WASM に落ちれば動く
    return false
  }
}

async function pickDevice(forceWasm: boolean): Promise<EmbeddingDevice> {
  const isNode = isNodeRuntime()
  // WASM 強制なら WebGPU の問い合わせ自体が無駄 (かつ落ちた直後の環境で
  // 触りたくない)。Node でも requestAdapter は無いので聞かない
  const hasWebGpuAdapter =
    isNode || forceWasm ? false : await probeWebGpuAdapter()
  return resolveDevice({ isNode, hasWebGpuAdapter, forceWasm })
}

async function loadLib(): Promise<Transformers> {
  const lib = await import('@huggingface/transformers')
  // ブラウザの WASM バックエンドは既定で ort の .wasm を CDN から取りに行く。
  // 自前配布した public/embedding-onnx/ を指して外部依存を断つ
  // (scripts/assets.mjs)。Node では無関係。
  // ブラウザ (メインスレッド/Worker 両方) でだけ自前配布を指す。Worker には
  // window が無いので window の有無ではなく「Node でない」で判定する。
  const wasm = lib.env.backends?.onnx?.wasm
  if (!isNodeRuntime() && wasm) {
    wasm.wasmPaths = '/embedding-onnx/'
  }
  // 注: ORT の警告 (「Removing initializer …」) を黙らせる細工はここには
  // 置いていない。DINOv2 では出ていないうえ、transformers.js は ort の
  // モジュール本体を外へ出さず、env.logLevel だけではセッション側の既定
  // (logSeverityLevel ?? 2) を変えられないため (理由は lib/ort/quietOrtLogs.ts)。
  // 出るようになったら、この Worker でも同じ細工を掛ける
  if (isNodeRuntime()) {
    // モデルキャッシュを書き込める場所に移す。既定はパッケージ相対の
    // node_modules/@huggingface/transformers/.cache で、本番 Docker は
    // /app が root 所有・実行ユーザーが node のため mkdir が EACCES で落ち、
    // 埋め込み生成がまるごと失敗する (実測)。/tmp はどの環境でも書ける。
    // コンテナ再起動でキャッシュは消えるが、初回の再取得 (数十 MB) で済む
    lib.env.cacheDir = `${process.env.TMPDIR ?? '/tmp'}/transformers-cache`
  }
  return lib
}

// 注意: **同じ Worker (realm) の中で WASM に組み直してはいけない**。
// 効きそうに見えるが必ず失敗する (41-QR-search/docs/11-画像検索調査メモ.md):
//   1. transformers.js は Web 環境のセッション生成を
//      `webInitChain = webInitChain.then(load)` で直列化しており、鎖が 1 度
//      reject すると catch でリセットされない。2 回目は load を実行すらせず
//      1 回目のエラーをそのまま再送出する (4.2.0・上流 main とも同じ)。
//   2. その下の onnxruntime-web も initializeWebAssembly()/initWasm() の失敗を
//      フラグでラッチし、以後は "previous call to ... failed" で即死する。
// どちらも realm 単位なので、フォールバックは Worker を作り直して行う
// (useImageEmbedder が forceWasm 付きで起こし直す)。
async function getExtractor(forceWasm = false): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      if (!libPromise) {
        libPromise = loadLib()
      }
      const lib = await libPromise
      const device = await pickDevice(forceWasm)
      attemptedDevice = device
      const extractor = await lib.pipeline(
        'image-feature-extraction',
        EMBEDDING_MODEL_ID,
        { dtype: EMBEDDING_DTYPE, device },
      )
      ready = true
      return extractor as unknown as Extractor
    })()
  }
  return extractorPromise
}

// 読み込みを試みた (または試みている) デバイス。失敗を報せるときに添える。
// Node は undefined を選ぶので 'unknown' に丸める (ブラウザ専用の情報)。
export function getAttemptedDevice(): 'webgpu' | 'wasm' | 'unknown' {
  return attemptedDevice === 'webgpu' || attemptedDevice === 'wasm'
    ? attemptedDevice
    : 'unknown'
}

// 初回のモデル読み込みが済んでいるか。UI が「準備中(初回)」を出すのに使う。
export function isEmbedderReady(): boolean {
  return ready
}

// 初回ロードを前もって温める (画像検索モーダルを開いた時点で呼ぶ)。
// forceWasm は WebGPU で落ちた後の作り直しで立てる (getExtractor のコメント)。
//
// 失敗を握りつぶすと、モデルを用意できなかった理由がコンソールの unhandled
// rejection にしか出ず、UI には当てずっぽうの案内しか出せない (自前配布した
// ort の wasm が 1 バリアント欠けていたのを、これで長く見落とした)。
// 呼び手が catch して理由を表示できるよう Promise を返す。
export async function preloadEmbedder(forceWasm = false): Promise<void> {
  await getExtractor(forceWasm)
}

// 画像 1 枚 → 正規化済み埋め込みベクトル。
// pool=false (既定) で last_hidden_state を受け、CLS トークンを取る
// (extractEmbedding)。CLIP 系に替えたら image_embeds をそのまま使う。
export async function embed(input: EmbedInput): Promise<Float32Array> {
  // getExtractor が内部で loadLib() を起こすので、待てば libPromise は確定する
  const extractor = await getExtractor()
  const lib = await libPromise!
  const image = await lib.RawImage.read(input)
  const tensor = await extractor(image)
  return extractEmbedding(tensor as unknown as TensorLike)
}
