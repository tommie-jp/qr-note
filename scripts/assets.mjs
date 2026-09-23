// ブラウザが実行時に取りに行くアセットを public/ へ揃える (docs/93-リファクタリング計画.md §7-1)。
//
//   node scripts/assets.mjs            # 変わっていないエントリは飛ばす
//   node scripts/assets.mjs --force    # 差分判定を無視して複製し直す
//
// `npm run dev` / `npm run build` の `copy:assets` がこれを呼ぶ。依存なし。
//
// 以前は copyTikzFonts / copyZxingWasm / copyOnnxWasm / copyEmbeddingWasm /
// copyPdfjsAssets / fetchPaddleOcrModels の 6 本が同じ骨格を複製していた。
// **何をどこへ運ぶか**は下の ASSETS 表 1 か所に置き、運び方 (複製・取得) は 1 本にする。
//
// なぜ自前で配るか (全エントリ共通): どのライブラリも既定では jsDelivr などの CDN から
// フォント・wasm・モデルを取りに行くが、外部依存を作りたくない。リポジトリにも
// 抱え込まず (宛先はすべて .gitignore 済み)、ビルドのたびに node_modules から複製する。
// JS グルーと wasm はバージョンがペアなので、node_modules から複製する形なら
// パッケージを更新しても両者がずれない (CDN 固定 URL や同梱だとずれる)。
//
// 複製元が消えていたら落とす (全エントリ共通): 黙って古いものや 0 個を配ると、
// バージョンずれで「スキャンだけ / OCR だけ / PDF だけ動かない」を後から追う羽目になる。
//
// 差分判定: `npm run dev` のたびに 160MB を複製し直さないよう、エントリごとに
// 「複製元のパス・サイズ・mtime と宛先」をスタンプとして STAMP_DIR に残す。
// スタンプが一致し、かつ宛先が全部同じサイズで在るときだけ飛ばす (宛先を消せば
// 次回は複製する)。STAMP_DIR は node_modules の中なので git にも Docker の
// ビルドコンテキストにも入らない (.dockerignore)。Docker の `npm run build` には
// スタンプが無いので必ず複製する。取得 (fetch) のエントリはスタンプを使わず、
// 従来どおり「下限サイズ以上のファイルが既に在るか」で判定する (--force でも取り直さない。
// 取り直したいときは宛先を消す)。
import { createRequire } from 'node:module'
import { copyFile, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STAMP_DIR = path.join(projectRoot, 'node_modules', '.cache', 'qr-assets')
const FORCE_FLAG = '--force'

// OCR モデルの配信元 (PaddleX 公式の推論モデル置き場)
const PADDLE_BASE_URL =
  'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0'

// PP-OCRv5 の mobile 版 (検出 + 認識)。日本語を含む統合モデルで、
// 公式パイプラインと同じ縦書き対応の組み合わせ (docs/24-画像OCR計画.md §2)。
// ファイル名は ocrService.ts の MODEL_ASSETS と対で効く。
const PADDLE_MODELS = ['PP-OCRv5_mobile_det', 'PP-OCRv5_mobile_rec']

// onnxruntime-web のスレッド版 SIMD の wasm と、それを読むグルー。バリアントは素
// (WASM 実行) のほか .jsep / .jspi / .asyncify があり、**どれが選ばれるかは実行時の
// ブラウザ能力で決まる** (WebGPU が有効な Chrome は .asyncify を取りに行く)。
// 決め打ちで絞ると取りこぼした端末だけ「no available backend found」で落ちるので、
// バリアントは列挙せず全部運ぶ (画像検索で実際に踏んだ)。実際に fetch されるのは
// 1 つだけなので、置いておく費用はディスクだけ。
const ORT_WASM = /^ort-wasm-simd-threaded[.\w]*\.(wasm|mjs)$/

const MB = 1024 * 1024
const toMb = (bytes) => (bytes / MB).toFixed(2)

/**
 * 運ぶものの表。
 *   name     … ログの先頭に出す名前
 *   dest     … 宛先 (リポジトリ直下からの相対)
 *   root     … 複製元の起点ディレクトリを返す関数 (パッケージの場所はここで解決する)
 *   copies   … 複製の指示。mode は
 *                'file' … root/from を dest/to へ 1 ファイル
 *                'dir'  … root/from の中のファイルを dest/to へ。include / exclude は
 *                         ファイル名に当てる正規表現、recursive で下位ディレクトリも辿る。
 *                         emptyError を持つものは 1 つも無ければその文言で落とす
 *   fetch    … 取得の指示 ({ url, to } の並び。minBytes 未満は壊れた取得とみなす)
 *   summary  … 運んだファイル ({ to, size } の並び) からログの本文を作る
 */
const ASSETS = [
  {
    // node-tikzjax が出力する SVG は輪郭パスではなく <text font-family="cmmi10"> を使うため、
    // Computer Modern の webfont を配らないと文字が化ける
    // (renderCircuit.cjs が fontCssUrl: '/tikzjax/fonts.css' を渡している)。
    // リポジトリに 3.7MB の TTF を抱え込まず、パッケージ同梱のものを複製する。
    //
    // fonts.css は 'bakoma/ttf/cmr10.ttf' のような相対 URL を持つため、
    // fonts.css と bakoma/ を同じ階層に置く必要がある
    name: 'tikzjax fonts',
    dest: 'public/tikzjax',
    root: () => packageDir('node-tikzjax'),
    copies: [
      { mode: 'file', from: 'css/fonts.css', to: 'fonts.css' },
      { mode: 'dir', from: 'css/bakoma', to: 'bakoma', recursive: true },
    ],
    summary: (files) =>
      `${files.filter((f) => path.dirname(f.to) === 'bakoma/ttf').length} files -> public/tikzjax/`,
  },
  {
    // スキャナの読み取りエンジン (barcode-detector → zxing-wasm)
    // (components/camera/ScannerModal.tsx が locateFile: () => '/zxing/zxing_reader.wasm' を渡している)。
    // reader ビルドを使う (読み取り専用。書き込み側は QR 生成の qrcode パッケージが持つ)
    name: 'zxing wasm',
    dest: 'public/zxing',
    root: () => packageDir('zxing-wasm'),
    copies: [{ mode: 'file', from: 'dist/reader/zxing_reader.wasm', to: 'zxing_reader.wasm' }],
    summary: (files) => `${toMb(sumSizes(files))} MB -> public/zxing/zxing_reader.wasm`,
  },
  {
    // OCR (@paddleocr/paddleocr-js) の推論エンジン onnxruntime-web
    // (OCR サービス側で ortOptions.wasmPaths = '/onnxruntime/' を指す)
    name: 'onnxruntime wasm',
    dest: 'public/onnxruntime',
    root: () => packageDir('onnxruntime-web'),
    copies: [
      {
        mode: 'dir',
        from: 'dist',
        to: '.',
        include: ORT_WASM,
        emptyError: 'onnxruntime-web の wasm が見つかりません',
      },
    ],
    summary: (files) => `${files.length} files -> public/onnxruntime/`,
  },
  {
    // 画像検索の埋め込み (transformers.js) をブラウザで動かすときの onnxruntime-web
    // (embedder.ts が env.backends.onnx.wasm.wasmPaths = '/embedding-onnx/' を指す)。
    //
    // 注意: OCR (上のエントリ) はトップレベルの onnxruntime-web を配るが、
    // transformers.js は自分の node_modules に別バージョンの onnxruntime-web を
    // 抱える。バージョンがずれると wasm とグルーが噛み合わないので、**必ず
    // transformers.js が抱える方**から複製する (配布先ディレクトリも分ける)。
    // 入れ子のパスを直書きせず、transformers.js の場所から Node の解決順で探す
    // (入れ子が無くなればバンドラと同じくトップレベルの方に解決される)。
    name: 'embedding onnx wasm',
    dest: 'public/embedding-onnx',
    root: () => packageDir('onnxruntime-web', packageDir('@huggingface/transformers')),
    copies: [
      {
        mode: 'dir',
        from: 'dist',
        to: '.',
        include: ORT_WASM,
        emptyError: 'transformers.js の onnxruntime-web wasm が見つかりません',
      },
    ],
    summary: (files) => `${files.length} files -> public/embedding-onnx/`,
  },
  {
    // 図を掴んで動かす殻の本体 (docs/99-フェンスGUI編集計画.md)。
    // 殻の頁は iframe の srcdoc で、中から <script src="/fence/map.web.js"> で読む
    // (components/fenceGui/openFenceGui.ts の FENCE_MAP_SCRIPT)。
    // バンドラに通さないのは、iframe の中は親と別の世界で、殻は自分の CSP と
    // nonce で 1 本だけを読む作りだから。fence-kit の版と必ず揃うよう
    // node_modules から運ぶ (上の wasm と同じ理由)
    name: 'fence-kit map',
    dest: 'public/fence',
    root: () => packageDir('fence-kit'),
    copies: [{ mode: 'file', from: 'dist/map.web.js', to: 'map.web.js' }],
    summary: (files) => `${(sumSizes(files) / 1024).toFixed(1)} KB -> public/fence/map.web.js`,
  },
  {
    // PDF ビューア (pdfjs-dist) が実行時に取りに行くアセット。
    //
    // Turbopack が worker の import.meta.url 相対解決を追えずビルドを落とすため、
    // worker は固定パス (/pdfjs/pdf.worker.min.mjs) で渡す。
    //
    // cmaps: 日本語 PDF は Adobe の定義済み CMap (Adobe-Japan1 など) をフォント参照に
    // 使う。これが無いと本文が空白や豆腐になる。169 ファイルあるが、pdf.js が必要な
    // ものだけ実行時に取るので転送量は 1 ファイル分しか増えない (ディスクを食うだけ)。
    //
    // standard_fonts: フォントを埋め込んでいない PDF (Helvetica などの標準 14 フォント
    // 指定) の描画に使う。
    //
    // wasm: JBIG2 / JPEG2000 の画像デコードと色管理 (qcms) に使う。
    // ただし quickjs-eval.* (PDF 内 JavaScript の実行エンジン) は複製しない —
    // enableScripting を有効にしないので使わず、置かないことで
    // 「うっかり有効化しても動かない」を構造で担保する。
    name: 'pdfjs assets',
    dest: 'public/pdfjs',
    root: () => packageDir('pdfjs-dist'),
    copies: [
      { mode: 'file', from: 'build/pdf.worker.min.mjs', to: 'pdf.worker.min.mjs' },
      ...['cmaps', 'standard_fonts', 'wasm', 'iccs'].map((dir) => ({
        mode: 'dir',
        from: dir,
        to: dir,
        exclude: /^quickjs-eval\./,
      })),
    ],
    summary: (files) => `${toMb(sumSizes(files))} MB -> public/pdfjs/`,
  },
  {
    // OCR の認識モデル。SDK の既定は百度の CDN (paddle-model-ecology.bj.bcebos.com) から
    // 直接取りに行くが、**そこはブラウザからは使えない**: レスポンスに
    // Access-Control-Allow-Origin が付かず CORS で弾かれる (実機で確認)。
    // 加えて配信元が中国本土のため初回ダウンロードが遅い。
    //
    // モデルは npm に入っていないのでここだけネットワークから取る。一度落としたら
    // 再取得しない (CI やクリーンビルドでは取りに行く)。
    //
    // minBytes: 落とし損ねた小さな HTML (エラーページ等) を掴んで「モデルが壊れている」に
    // 化けるのを防ぐ。実物は det 4.8MB / rec 16.7MB なので 1MB を下限にする。
    name: 'paddle-ocr models',
    dest: 'public/paddle-ocr',
    fetch: PADDLE_MODELS.map((model) => ({
      url: `${PADDLE_BASE_URL}/${model}_onnx_infer.tar`,
      to: `${model}.tar`,
    })),
    minBytes: MB,
    summary: (files) =>
      files.length === 0
        ? 'already present -> public/paddle-ocr/'
        : `${files.length} files -> public/paddle-ocr/`,
  },
]

function sumSizes(files) {
  return files.reduce((sum, f) => sum + f.size, 0)
}

/**
 * パッケージのディレクトリを Node の解決順 (fromDir から上へ node_modules を辿る) で探す。
 * package.json を exports で塞いでいるパッケージ (onnxruntime-web など) でも引けるよう、
 * require.resolve ではなく探索パスの一覧だけを借りる。
 */
function packageDir(name, fromDir = projectRoot) {
  const lookup = createRequire(path.join(fromDir, 'package.json')).resolve.paths(name) ?? []
  const found = lookup
    .map((dir) => path.join(dir, name))
    .find((dir) => existsSync(path.join(dir, 'package.json')))
  if (found === undefined) {
    throw new Error(`パッケージ ${name} が見つかりません (${fromDir} から探索)。npm install を済ませたか確認すること`)
  }
  return found
}

/** ディレクトリの中のファイルを { rel, abs } で列挙する (recursive なら下位も辿る) */
async function listFiles(dir, { recursive }) {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const abs = path.join(dir, entry.name)
      if (entry.isFile()) return [{ rel: entry.name, abs }]
      if (!recursive || !entry.isDirectory()) return []
      const children = await listFiles(abs, { recursive })
      return children.map((child) => ({ rel: path.join(entry.name, child.rel), abs: child.abs }))
    }),
  )
  return nested.flat().toSorted((a, b) => a.rel.localeCompare(b.rel))
}

/** 1 つの複製指示を { from, to } (絶対 / dest 相対) の並びへ展開する */
async function expandCopy(root, copy) {
  const from = path.join(root, copy.from)
  if (copy.mode === 'file') return [{ from, to: copy.to }]

  const files = (await listFiles(from, { recursive: copy.recursive === true })).filter(
    ({ rel }) => {
      const base = path.basename(rel)
      return (copy.include?.test(base) ?? true) && !(copy.exclude?.test(base) ?? false)
    },
  )
  if (files.length === 0 && copy.emptyError !== undefined) {
    throw new Error(`${copy.emptyError}: ${from}`)
  }
  return files.map(({ rel, abs }) => ({ from: abs, to: path.join(copy.to, rel) }))
}

/** エントリの複製計画 (複製元のサイズと mtime 付き) を作る。複製元が無ければここで落ちる */
async function planCopies(asset) {
  const root = asset.root()
  const pairs = (await Promise.all(asset.copies.map((copy) => expandCopy(root, copy)))).flat()
  return Promise.all(
    pairs.map(async (pair) => {
      const info = await stat(pair.from)
      return { ...pair, size: info.size, mtimeMs: info.mtimeMs }
    }),
  )
}

function stampPath(asset) {
  return path.join(STAMP_DIR, `${path.basename(asset.dest)}.json`)
}

function stampOf(asset, plan) {
  return JSON.stringify({
    dest: asset.dest,
    files: plan.map((p) => [path.relative(projectRoot, p.from), p.to, p.size, p.mtimeMs]),
  })
}

async function readStamp(asset) {
  try {
    return await readFile(stampPath(asset), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

/** node_modules は他の作業ツリーとハードリンクを共有しうるので、上書きせず置き換える */
async function writeStamp(asset, stamp) {
  await mkdir(STAMP_DIR, { recursive: true })
  const tmp = `${stampPath(asset)}.${process.pid}.tmp`
  await writeFile(tmp, stamp)
  await rename(tmp, stampPath(asset))
}

async function sizeOrNull(filePath) {
  try {
    return (await stat(filePath)).size
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function isUpToDate(asset, plan, stamp) {
  if ((await readStamp(asset)) !== stamp) return false
  const destDir = path.join(projectRoot, asset.dest)
  const sizes = await Promise.all(plan.map((p) => sizeOrNull(path.join(destDir, p.to))))
  return sizes.every((size, i) => size === plan[i].size)
}

async function runCopy(asset, { force }) {
  const plan = await planCopies(asset)
  const stamp = stampOf(asset, plan)
  const line = `${asset.name}: ${asset.summary(plan)}`
  if (!force && (await isUpToDate(asset, plan, stamp))) {
    return `${line} (unchanged, skipped)`
  }

  const destDir = path.join(projectRoot, asset.dest)
  for (const { from, to } of plan) {
    const target = path.join(destDir, to)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(from, target)
  }
  await writeStamp(asset, stamp)
  return line
}

async function alreadyFetched(filePath, minBytes) {
  const size = await sizeOrNull(filePath)
  return size !== null && size >= minBytes
}

async function runFetch(asset) {
  const destDir = path.join(projectRoot, asset.dest)
  await mkdir(destDir, { recursive: true })

  const fetched = []
  for (const { url, to } of asset.fetch) {
    const destPath = path.join(destDir, to)
    if (await alreadyFetched(destPath, asset.minBytes)) continue

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`OCR モデルを取得できません: ${url} (${response.status})`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    // 黙って 0 バイトを配ると「OCR だけ動かない」を後から追う羽目になる
    if (bytes.byteLength < asset.minBytes) {
      throw new Error(`OCR モデルが小さすぎます: ${url} (${bytes.byteLength} bytes)`)
    }
    await writeFile(destPath, bytes)
    fetched.push({ to, size: bytes.byteLength })
  }
  return `${asset.name}: ${asset.summary(fetched)}`
}

async function main() {
  const args = process.argv.slice(2)
  const unknown = args.filter((arg) => arg !== FORCE_FLAG)
  if (unknown.length > 0) {
    throw new Error(`未知の引数: ${unknown.join(' ')} (使えるのは ${FORCE_FLAG} のみ)`)
  }
  const force = args.includes(FORCE_FLAG)

  // 直列に回す。途中のエントリで落ちたら後続は運ばない (6 本を && で繋いでいた頃と同じ)
  for (const asset of ASSETS) {
    const line = asset.fetch ? await runFetch(asset) : await runCopy(asset, { force })
    console.log(line)
  }
}

await main()
