// 文書参照の切れを検査する (docs/93-リファクタリング計画.md §2-6)。
//
//   node scripts/checkDocLinks.mjs [--workspace-docs=<dir>]
//
// 切れた参照が 1 つでもあれば一覧を出して終了コード 1、無ければ 0。依存なし。
//
// 拾うもの:
//   1. `docs/<番号>-<名前>.md` という言及 (README・docs・コメントのどこでも)。
//      リポジトリ直下からの相対とみなし、アプリの docs/ で解決する。
//   2. `41-QR-search/docs/<番号>-<名前>.md` という言及。ワークスペース側
//      (このリポジトリを置いている非公開リポジトリ) の 01〜21 番を指す約束。
//      既定では `../docs` が在るときだけ検査し、無ければ (公開リポジトリを
//      単独で clone した場合) 数えるだけで飛ばす。
//   3. markdown ファイル内のリンク `[..](<相対パス>.md)`。そのファイルからの
//      相対で解決する。
//   4. 番号だけの `docs/<番号>` / `41-QR-search/docs/<番号>`。その番号の文書が
//      在ることだけ確かめる (どの文書を指したつもりかまでは判らない)。
//
// markdown リンクで .md 以外 (`../src/lib/x.ts` など) を見ないのはわざと。
// 古い計画書のソースパス言及は「当時のパス」のまま据え置く方針なので
// (docs/93 §7-6)、ファイル移動のたびに落ちる検査にしない。
//
// `node_modules/next/dist/docs/01-app/...` のような他所の docs/ を拾わないよう、
// `docs/` の直前が英数字・`.`・`/`・`-` なら言及とみなさない (2. の接頭辞を除く)。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ワークスペース側の文書を指すときに docs/ の前へ付ける名前 (正規表現の特殊文字を含まない)
const WORKSPACE_NAME = '41-QR-search'
const WORKSPACE_DOCS_FLAG = '--workspace-docs='

// 走査する場所。ディレクトリは再帰で、拡張子で絞る (null は全ファイル)
const SCAN_DIRS = [
  { dir: 'docs', exts: ['.md'] },
  { dir: 'src', exts: ['.ts', '.tsx', '.css'] },
  { dir: 'scripts', exts: null },
  { dir: 'deploy', exts: null },
]
const ROOT_FILE_PATTERNS = [/^README\.md$/, /\.sh$/, /^Dockerfile$/, /^compose.*\.yaml$/, /^next\.config\.ts$/]
const SKIP_DIR_NAMES = new Set(['node_modules', '.next', 'generated'])
const BINARY_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.svg', '.ico', '.wasm', '.pdf'])

// 名前部分に使わない文字: 空白・パス区切り・括弧・引用符・markdown の記号
const NAME_CHARS = String.raw`[^\s/\\()[\]{}<>` + '`' + String.raw`'"|*]+?`
const DOCS_PREFIX = String.raw`(?:(${WORKSPACE_NAME}\/)|(?<![\w./-]))docs\/`
const MENTION_RE = new RegExp(String.raw`${DOCS_PREFIX}(\d{2,}-${NAME_CHARS}\.md)`, 'g')
// `docs/47` や `docs/12/14`・`docs/04〜92`。`docs/01-app/...` のような名前付きは除く
const NUMBER_RE = new RegExp(String.raw`${DOCS_PREFIX}(\d{2,})(?![\d-])`, 'g')
const DOC_NUMBER_RE = /^(\d{2,})-.*\.md$/
const LINK_RE = /\]\(\s*<?([^()\s<>]+?\.md)(?:#[^()\s<>]*)?>?(?:\s+"[^"]*")?\s*\)/g
const EXTERNAL_LINK_RE = /^[a-z][a-z0-9+.-]*:/i

/** 本文中の位置 → 1 始まりの行番号、を返す関数を作る */
function makeLineOf(text) {
  const lineStarts = [0, ...[...text.matchAll(/\n/g)].map((m) => m.index + 1)]
  return (index) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (lineStarts[mid] <= index) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

function safeDecode(target) {
  try {
    return decodeURIComponent(target)
  } catch {
    // % を含むだけの素のファイル名はそのまま扱う (壊れたエスケープで落とさない)
    return target
  }
}

/**
 * 1 ファイルの本文から文書参照を拾う (純関数)。
 * @param {string} text 本文
 * @param {{ isMarkdown: boolean }} options
 * @returns {{ scope: 'app' | 'workspace' | 'relative', kind: 'file' | 'number', target: string, line: number }[]}
 */
export function findDocReferences(text, { isMarkdown }) {
  const lineOf = makeLineOf(text)
  const scopeOf = (m) => (m[1] ? 'workspace' : 'app')
  const files = [...text.matchAll(MENTION_RE)].map((m) => ({
    scope: scopeOf(m),
    kind: 'file',
    target: m[2],
    line: lineOf(m.index),
  }))
  const numbers = [...text.matchAll(NUMBER_RE)].map((m) => ({
    scope: scopeOf(m),
    kind: 'number',
    target: m[2],
    line: lineOf(m.index),
  }))
  if (!isMarkdown) return [...files, ...numbers]

  const links = [...text.matchAll(LINK_RE)]
    .filter((m) => !EXTERNAL_LINK_RE.test(m[1]) && !m[1].startsWith('/'))
    .map((m) => ({ scope: 'relative', kind: 'file', target: safeDecode(m[1]), line: lineOf(m.index) }))
  return [...files, ...numbers, ...links]
}

/** docs ディレクトリに在る文書番号の集合 */
function listDocNumbers(docsDir) {
  const numbers = readdirSync(docsDir)
    .map((name) => DOC_NUMBER_RE.exec(name)?.[1])
    .filter((n) => n !== undefined)
  return new Set(numbers)
}

function listFilesRecursive(absDir, exts) {
  if (!existsSync(absDir)) return []
  return readdirSync(absDir, { withFileTypes: true }).flatMap((entry) => {
    const abs = path.join(absDir, entry.name)
    if (entry.isDirectory()) {
      return SKIP_DIR_NAMES.has(entry.name) ? [] : listFilesRecursive(abs, exts)
    }
    const ext = path.extname(entry.name).toLowerCase()
    if (BINARY_EXTS.has(ext)) return []
    return exts === null || exts.includes(ext) ? [abs] : []
  })
}

function listScanTargets(root) {
  const rootFiles = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && ROOT_FILE_PATTERNS.some((re) => re.test(entry.name)))
    .map((entry) => path.join(root, entry.name))
  const dirFiles = SCAN_DIRS.flatMap(({ dir, exts }) => listFilesRecursive(path.join(root, dir), exts))
  return [...rootFiles, ...dirFiles]
}

function resolveWorkspaceDocs(root, argv) {
  const flag = argv.find((arg) => arg.startsWith(WORKSPACE_DOCS_FLAG))
  const dir = flag ? path.resolve(flag.slice(WORKSPACE_DOCS_FLAG.length)) : path.resolve(root, '..', 'docs')
  const isDirectory = existsSync(dir) && statSync(dir).isDirectory()
  if (flag && !isDirectory) {
    throw new Error(`${WORKSPACE_DOCS_FLAG} に指定したディレクトリが無い: ${dir}`)
  }
  return isDirectory ? dir : null
}

/** 参照 1 件を実体に当てる。ワークスペース側を検査できないときは null */
function resolveReference(ref, { root, file, workspaceDocs, docNumbers }) {
  if (ref.scope === 'relative') {
    const abs = path.resolve(path.dirname(file), ref.target)
    return { key: abs, exists: existsSync(abs) }
  }
  const docsDir = ref.scope === 'workspace' ? workspaceDocs : path.join(root, 'docs')
  if (docsDir === null) return null
  if (ref.kind === 'number') {
    return { key: `${docsDir}#${ref.target}`, exists: docNumbers[ref.scope].has(ref.target) }
  }
  const abs = path.join(docsDir, ref.target)
  return { key: abs, exists: existsSync(abs) }
}

function checkFile(file, context) {
  const text = readFileSync(file, 'utf8')
  const refs = findDocReferences(text, { isMarkdown: file.endsWith('.md') })
  const resolved = refs.map((ref) => ({ ref, hit: resolveReference(ref, { ...context, file }) }))
  const checkable = resolved.filter(({ hit }) => hit !== null)
  // README の `[..](docs/NN-x.md)` は言及とリンクの両方に当たるので、同じ行・同じ実体は 1 件にまとめる
  const unique = [...new Map(checkable.map((item) => [`${item.ref.line}:${item.hit.key}`, item])).values()]
  const broken = unique
    .filter(({ hit }) => !hit.exists)
    .map(({ ref }) => ({ file: path.relative(context.root, file), ...ref }))
    .toSorted((a, b) => a.line - b.line)
  return { checked: unique.length, skipped: resolved.length - checkable.length, broken }
}

function main() {
  let workspaceDocs
  try {
    workspaceDocs = resolveWorkspaceDocs(projectRoot, process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 2
    return
  }
  const docNumbers = {
    app: listDocNumbers(path.join(projectRoot, 'docs')),
    workspace: workspaceDocs ? listDocNumbers(workspaceDocs) : new Set(),
  }
  const context = { root: projectRoot, workspaceDocs, docNumbers }
  const results = listScanTargets(projectRoot).map((file) => checkFile(file, context))
  const checked = results.reduce((sum, r) => sum + r.checked, 0)
  const skipped = results.reduce((sum, r) => sum + r.skipped, 0)
  const broken = results.flatMap((r) => r.broken)

  const workspaceNote = workspaceDocs
    ? `ワークスペース側は ${workspaceDocs} で検査`
    : `ワークスペース側 (${WORKSPACE_NAME}/docs/) の ${skipped} 件は ../docs が無いので飛ばした`
  for (const b of broken) {
    console.error(`${b.file}:${b.line}: 切れた参照 (${b.scope}) ${b.kind === 'number' ? `docs/${b.target}` : b.target}`)
  }
  console.log(`文書参照 ${checked} 件を検査、切れ ${broken.length} 件 (${workspaceNote})`)
  process.exitCode = broken.length > 0 ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
