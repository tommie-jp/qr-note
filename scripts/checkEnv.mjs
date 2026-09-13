// 環境変数とボディサイズ上限の「3 重定義」のずれを検査する (docs/93-リファクタリング計画.md §7-3)。
//
//   node scripts/checkEnv.mjs
//
// 想定外のずれが 1 つでもあれば一覧を出して終了コード 1、無ければ 0。
// 読めない・数えられない (定数が見つからない等) ときは 2。依存なし。
//
// なぜ要るか: 環境変数は .env.example・compose.yaml の app の environment:・コードの
// process.env の 3 か所に書かれ、どれか 1 つを忘れても起動はする。特に compose.yaml は
// 「.env に足しても environment: に無い変数はコンテナに届かない」ので、設定したのに
// 未設定と言われる事故が実際に起きた (compose.yaml の RAKUTEN_* の注、
// docs/29-パスキー計画.md §12)。本体サイズの上限も Caddyfile・deploy/nginx/*.conf・
// src の定数の 3 か所 3 記法で、片方だけ変えるとアプリに届く前に 413 で切られる。
//
// 検査すること (環境変数):
//   in-compose    src (テスト以外) が読む変数は compose.yaml の app の environment: にある
//   in-example    コード (src・scripts・prisma.config.ts・next.config.ts) が読む変数は
//                 .env.example にある (コメントアウトした `# NAME=` の行も「書いてある」と数える)
//   read-by-app   compose.yaml の app の environment: の変数は src (テスト以外) が読む
//   interp        compose.yaml の ${NAME} は .env.example にある
//   used          .env.example の変数はどこか (コード・compose.yaml) で使われている
//
// 検査すること (本体サイズの上限): 下の limitRules。等しさではなく**意図した大小関係**を
// 見る (エッジは multipart の余白ぶん大きくてよい、など)。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(projectRoot, rel), 'utf8')

// ---------------------------------------------------------------------------
// 意図的なずれの表 (環境変数)。キー → 免除する検査。理由は各行のコメント
// ---------------------------------------------------------------------------
const ENV_ALLOW = {
  // Next.js と Dockerfile (runner の ENV) が決める。.env や compose で上書きしない
  NODE_ENV: ['in-compose', 'in-example'],
  // Next.js 内部。instrumentation.ts が実行環境 (nodejs / edge) の判定に読むだけ
  NEXT_RUNTIME: ['in-compose', 'in-example'],
  // OS の変数。notesRepo.ts が git の子プロセスへ引き継ぐ / 埋め込みのキャッシュ置き場
  PATH: ['in-compose', 'in-example'],
  TMPDIR: ['in-compose', 'in-example'],
  // テスト専用。DB を叩く統合テストを走らせる旗 (README「テスト」に書いてある)
  RUN_DB_TESTS: ['in-example'],
  // compose からは渡さない。既定 (<cwd>/data/git-notes) がコンテナでは named volume の
  // マウント先 /app/data/git-notes にそのまま一致する。差し替えるのはテストと開発だけ
  // (.env.example にはコメントアウトで説明を置いた)
  QR_GIT_DIR: ['in-compose'],
}

// ---------------------------------------------------------------------------
// 既知のずれ (本体サイズの上限)。直すと挙動が変わるので検査の側で覚えておき、
// 警告として出す (終了コードには数えない)。直したら消すこと
// ---------------------------------------------------------------------------
const KNOWN_LIMIT_GAPS = {
  // Caddy の max_size は go-humanize の解釈で MB = 10^6 バイト (MiB が 2^20)。512MB は
  // 512,000,000 バイトで MAX_ZIP_BYTES (500 MiB = 524,288,000) に 12MB 足りない。
  // 本番の nginx (512M = 512 MiB) は足りているので、影響は compose の proxy
  // プロファイル (ローカル再現) だけ。直すなら Caddyfile を 512MiB にする
  'caddy-import-fits-zip': 'Caddyfile の 512MB は SI 単位 (512,000,000 バイト)',
}

// ---------------------------------------------------------------------------
// 環境変数を集める
// ---------------------------------------------------------------------------
const SKIP_DIRS = new Set(['node_modules', '.next', 'generated'])
const CODE_EXTS = new Set(['.ts', '.tsx', '.mjs', '.cjs', '.js'])
const ENV_READ_RE = /process\.env(?:\.([A-Z_][A-Z0-9_]*)|\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\])/g
const TEST_FILE_RE = /\.test\.[cm]?[jt]sx?$/

function listCodeFiles(relDir) {
  const abs = path.join(projectRoot, relDir)
  if (!existsSync(abs)) return []
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(relDir, entry.name)
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : listCodeFiles(rel)
    return CODE_EXTS.has(path.extname(entry.name)) ? [rel] : []
  })
}

/** コードが読む変数 → 読んでいるファイルの一覧 */
function collectEnvReads(files) {
  const reads = new Map()
  for (const file of files) {
    for (const m of read(file).matchAll(ENV_READ_RE)) {
      const key = m[1] ?? m[2]
      reads.set(key, [...(reads.get(key) ?? []), file])
    }
  }
  return reads
}

/** .env.example の変数名。`NAME=` と、コメントアウトで説明だけ置いた `# NAME=` の両方 */
export function parseEnvExample(text) {
  return new Set([...text.matchAll(/^(?:# ?)?([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]))
}

/**
 * compose.yaml の services.<service>.environment: のキー (YAML の小さな部分集合だけを読む)。
 * `KEY: value` のマップ形式と `- KEY=value` のリスト形式を受ける。
 */
export function parseComposeEnvironment(text, service) {
  const lines = text.split('\n')
  const indentOf = (line) => line.length - line.trimStart().length
  const isBlank = (line) => line.trim() === '' || line.trim().startsWith('#')

  const serviceAt = lines.findIndex((line) => new RegExp(`^\\s+${service}:\\s*$`).test(line))
  if (serviceAt < 0) throw new Error(`compose.yaml に services.${service} が見つからない`)
  const serviceIndent = indentOf(lines[serviceAt])

  const envAt = lines.findIndex(
    (line, i) => i > serviceAt && /^\s+environment:\s*$/.test(line) && indentOf(line) > serviceIndent,
  )
  if (envAt < 0) throw new Error(`compose.yaml の services.${service} に environment: が無い`)
  const envIndent = indentOf(lines[envAt])

  const keys = new Set()
  for (const line of lines.slice(envAt + 1)) {
    if (isBlank(line)) continue
    if (indentOf(line) <= envIndent) break
    const m = /^\s+(?:-\s*)?([A-Z_][A-Z0-9_]*)\s*[:=]/.exec(line)
    if (m) keys.add(m[1])
  }
  return keys
}

/** compose.yaml の ${NAME} / ${NAME:-x} / ${NAME:?x} で参照する変数 (コメント行は除く) */
export function parseComposeInterpolations(text) {
  const body = text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')
  return new Set([...body.matchAll(/\$\{([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]))
}

const isAllowed = (key, checkId) => ENV_ALLOW[key]?.includes(checkId) ?? false
const difference = (a, b) => [...a].filter((x) => !b.has(x)).toSorted()

function checkEnv() {
  const srcFiles = listCodeFiles('src')
  const runtimeFiles = srcFiles.filter((f) => !TEST_FILE_RE.test(f))
  const configFiles = ['prisma.config.ts', 'next.config.ts'].filter((f) => existsSync(path.join(projectRoot, f)))
  const allReads = collectEnvReads([...srcFiles, ...listCodeFiles('scripts'), ...configFiles])
  const runtimeReads = new Set(collectEnvReads(runtimeFiles).keys())

  const composeText = read('compose.yaml')
  const example = parseEnvExample(read('.env.example'))
  const appEnv = parseComposeEnvironment(composeText, 'app')
  const interp = parseComposeInterpolations(composeText)
  const used = new Set([...allReads.keys(), ...appEnv, ...interp])

  const checks = [
    ['in-compose', 'src が読むのに compose.yaml の app の environment: に無い (コンテナに届かない)', difference(runtimeReads, appEnv)],
    ['in-example', 'コードが読むのに .env.example に無い', difference(new Set(allReads.keys()), example)],
    ['read-by-app', 'compose.yaml の app に渡しているのに src が読んでいない', difference(appEnv, runtimeReads)],
    ['interp', 'compose.yaml の ${NAME} が .env.example に無い', difference(interp, example)],
    ['used', '.env.example にあるのにどこからも使われていない', difference(example, used)],
  ]
  return checks.map(([id, title, keys]) => ({
    id,
    title,
    gaps: keys.filter((key) => !isAllowed(key, id)),
    allowed: keys.filter((key) => isAllowed(key, id)),
    whereRead: (key) => allReads.get(key) ?? [],
  }))
}

// ---------------------------------------------------------------------------
// 本体サイズの上限
// ---------------------------------------------------------------------------

/** Caddy の max_size (go-humanize の ParseBytes)。k/M/G は 1000 系、Ki/Mi/Gi が 1024 系 */
export function parseCaddySize(text) {
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/i.exec(text.trim())
  const units = { '': 1, b: 1, k: 1e3, kb: 1e3, ki: 2 ** 10, kib: 2 ** 10, m: 1e6, mb: 1e6, mi: 2 ** 20, mib: 2 ** 20, g: 1e9, gb: 1e9, gi: 2 ** 30, gib: 2 ** 30 }
  const unit = m ? units[m[2].toLowerCase()] : undefined
  if (unit === undefined) throw new Error(`Caddy のサイズを読めない: ${text}`)
  return Number(m[1]) * unit
}

/** nginx の client_max_body_size。k/m/g はどれも 1024 系 */
export function parseNginxSize(text) {
  const m = /^(\d+)([kmg]?)$/i.exec(text.trim())
  if (!m) throw new Error(`nginx のサイズを読めない: ${text}`)
  const unit = { '': 1, k: 2 ** 10, m: 2 ** 20, g: 2 ** 30 }[m[2].toLowerCase()]
  return Number(m[1]) * unit
}

/** Caddyfile の request_body → { default, paths: { '/api/import': バイト } } */
export function parseCaddyLimits(text) {
  const matchers = Object.fromEntries(
    [...text.matchAll(/^\s*@(\w+)\s+path\s+(\S+)\s*$/gm)].map((m) => [m[1], m[2]]),
  )
  const limits = { default: undefined, paths: {} }
  for (const m of text.matchAll(/request_body(?:\s+@(\w+))?\s*\{\s*max_size\s+(\S+)\s*\}/g)) {
    const bytes = parseCaddySize(m[2])
    if (m[1] === undefined) limits.default = bytes
    else limits.paths[matchers[m[1]] ?? `@${m[1]}`] = bytes
  }
  return limits
}

/** nginx conf の client_max_body_size → { default (server 直下), paths: { location のパス: バイト } } */
export function parseNginxLimits(text) {
  const body = text
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n')
  const limits = { default: undefined, paths: {} }
  const locationRe = /location\s+(?:[=~^]+\s+)?(\S+)\s*\{([^{}]*)\}/g
  for (const m of body.matchAll(locationRe)) {
    const size = /client_max_body_size\s+(\S+?);/.exec(m[2])
    if (size) limits.paths[m[1]] = parseNginxSize(size[1])
  }
  const serverLevel = [...body.replace(locationRe, '').matchAll(/client_max_body_size\s+(\S+?);/g)]
  if (serverLevel.length > 1) throw new Error('server 直下の client_max_body_size が複数ある')
  if (serverLevel.length === 1) limits.default = parseNginxSize(serverLevel[0][1])
  return limits
}

/**
 * src (テスト以外) の `export const NAME = 式` を集める。式は数値・定数名・* と + だけ。
 * ファイルの場所は決め打ちしない (分割・移動しても定数名で引ける)
 */
export function collectByteConstants(files) {
  const exprs = new Map()
  for (const file of files) {
    for (const m of read(file).matchAll(/^export const ([A-Z][A-Z0-9_]*)[ \t]*=[ \t]*([0-9A-Z_ \t*+]+?)[ \t]*;?[ \t]*$/gm)) {
      exprs.set(m[1], [...(exprs.get(m[1]) ?? []), { expr: m[2], file }])
    }
  }
  return exprs
}

export function evaluateConstant(name, exprs, seen = new Set()) {
  const entries = exprs.get(name) ?? []
  if (entries.length === 0) throw new Error(`定数 ${name} が src に見つからない (改名したらこのスクリプトも直す)`)
  if (entries.length > 1) throw new Error(`定数 ${name} が複数定義されている (${entries.map((e) => e.file).join(' / ')})`)
  const [entry] = entries
  if (seen.has(name)) throw new Error(`定数 ${name} が循環している`)
  const next = new Set([...seen, name])
  const factor = (token) => {
    const t = token.trim().replaceAll('_', '')
    return /^\d+$/.test(t) ? Number(t) : evaluateConstant(token.trim(), exprs, next)
  }
  return entry.expr
    .split('+')
    .map((term) => term.split('*').map(factor).reduce((a, b) => a * b, 1))
    .reduce((a, b) => a + b, 0)
}

const MiB = 2 ** 20
const fmt = (bytes) => `${bytes.toLocaleString('en-US')} バイト (${(bytes / MiB).toFixed(1)} MiB)`

/**
 * 意図した大小関係。edge / app はどちらもバイト数を返す関数、op は '>=' か '<'。
 *   - エッジの既定の上限 ≥ アプリの門 (MAX_VIDEO_BYTES + MULTIPART_OVERHEAD_BYTES)。
 *     小さいと録画がアプリに届く前に 413 になる
 *   - エッジの /api/import の上限 ≥ MAX_ZIP_BYTES (取り込みは multipart を使わず本文を
 *     そのまま流すので余白は要らない)。小さいとブラウザには "Load failed" としか出ない
 *   - エッジの既定の上限 < MAX_ZIP_BYTES。**既定を取り込みの大きさまで上げない**のが
 *     要点で、500MB をどの口へでも投げ込めるようにしない
 *   - デモのエッジ ≥ デモの門 (DEMO_MAX_IMAGE_BYTES + 余白)、かつ < 本番の門
 *     (デモは動画を扱わないので、本番の動画枠まで開けない)
 */
function limitRules({ caddy, nginx, nginxDemo, c }) {
  const appGate = c('MAX_VIDEO_BYTES') + c('MULTIPART_OVERHEAD_BYTES')
  const demoGate = c('DEMO_MAX_IMAGE_BYTES') + c('MULTIPART_OVERHEAD_BYTES')
  const zip = c('MAX_ZIP_BYTES')
  return [
    ['caddy-default-fits-upload', 'Caddyfile の既定 ≥ アップロードの門 (動画 + 余白)', caddy.default, '>=', appGate],
    ['caddy-import-fits-zip', 'Caddyfile の /api/import ≥ MAX_ZIP_BYTES', caddy.paths['/api/import'], '>=', zip],
    ['caddy-default-below-zip', 'Caddyfile の既定 < MAX_ZIP_BYTES (既定を取り込みの大きさに開けない)', caddy.default, '<', zip],
    ['nginx-default-fits-upload', 'qr.tommie.jp.conf の既定 ≥ アップロードの門 (動画 + 余白)', nginx.default, '>=', appGate],
    ['nginx-import-fits-zip', 'qr.tommie.jp.conf の /api/import ≥ MAX_ZIP_BYTES', nginx.paths['/api/import'], '>=', zip],
    ['nginx-default-below-zip', 'qr.tommie.jp.conf の既定 < MAX_ZIP_BYTES (既定を取り込みの大きさに開けない)', nginx.default, '<', zip],
    ['demo-default-fits-upload', 'qr-demo.tommie.jp.conf の既定 ≥ デモの門 (2MB + 余白)', nginxDemo.default, '>=', demoGate],
    ['demo-default-below-upload', 'qr-demo.tommie.jp.conf の既定 < 本番の門 (デモに動画枠は要らない)', nginxDemo.default, '<', appGate],
  ]
}

function checkLimits() {
  const exprs = collectByteConstants(listCodeFiles('src').filter((f) => !TEST_FILE_RE.test(f)))
  const c = (name) => evaluateConstant(name, exprs)
  const rules = limitRules({
    caddy: parseCaddyLimits(read('Caddyfile')),
    nginx: parseNginxLimits(read('deploy/nginx/qr.tommie.jp.conf')),
    nginxDemo: parseNginxLimits(read('deploy/nginx/qr-demo.tommie.jp.conf')),
    c,
  })
  return rules.map(([id, title, edge, op, app]) => {
    if (edge === undefined) throw new Error(`${title}: エッジ側の上限が見つからない`)
    const ok = op === '>=' ? edge >= app : edge < app
    return { id, title, ok, detail: `エッジ ${fmt(edge)} ${op} アプリ ${fmt(app)}` }
  })
}

// ---------------------------------------------------------------------------

function report(envChecks, limitChecks) {
  let failures = 0
  console.log('== 環境変数 (.env.example / compose.yaml / process.env)')
  for (const check of envChecks) {
    const mark = check.gaps.length === 0 ? 'OK ' : 'NG '
    const allowed = check.allowed.length > 0 ? ` (意図的: ${check.allowed.join(', ')})` : ''
    console.log(`  ${mark} [${check.id}] ${check.title}${allowed}`)
    for (const key of check.gaps) {
      const where = check.whereRead(key)
      console.log(`        - ${key}${where.length > 0 ? `  (${[...new Set(where)].join(', ')})` : ''}`)
    }
    failures += check.gaps.length
  }

  console.log('== 本体サイズの上限 (Caddyfile / deploy/nginx / src の定数)')
  for (const check of limitChecks) {
    const known = KNOWN_LIMIT_GAPS[check.id]
    const mark = check.ok ? 'OK ' : known ? '既知' : 'NG '
    console.log(`  ${mark} [${check.id}] ${check.title}`)
    console.log(`        ${check.detail}`)
    if (!check.ok && known) console.log(`        既知のずれ: ${known}`)
    if (!check.ok && !known) failures += 1
    if (check.ok && known) {
      console.log('        (直ったので KNOWN_LIMIT_GAPS から消すこと)')
      failures += 1
    }
  }
  return failures
}

function main() {
  let failures
  try {
    failures = report(checkEnv(), checkLimits())
  } catch (error) {
    console.error(`検査できない: ${error.message}`)
    process.exitCode = 2
    return
  }
  console.log(failures === 0 ? '想定外のずれ 0 件' : `想定外のずれ ${failures} 件`)
  process.exitCode = failures === 0 ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
