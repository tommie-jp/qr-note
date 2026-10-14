// 教科書 (tommie-circuit-workbook) の 1 冊を、QR Note の ZIP 取り込み
// (src/lib/zip) が読める形に変換する (docs/104)。
//
// 使い方:
//   node scripts/convertWorkbookToZip.mjs <教科書の置き場> <冊のディレクトリ名> <出力.zip> [YYYY-MM-DD]
//   例: node scripts/convertWorkbookToZip.mjs ~/52-tommie-fence/tommie-circuit-workbook 04-denken _del/wb-04.zip
//
// 変換 (決めは docs/104 §4):
//   1. front matter を外す。見出し行 (# …) はそのまま。末尾にタグ行を足す
//   2. QR Note が描けるフェンスの下の「Pages の SVG への画像行」を外す (同じ図が 2 つ出るため)。
//      描けないフェンス (plantuml) の画像行は残す
//   3. フェンス名の別名を直す (bread → breadboard、perf → perfboard)
//   4. `data:` が指すファイルを添付に取り込み、フェンスの前に `![名前](../images/…)` を置く
//   5. 題どうしのリンク (….md) を /item/<itemNo> へ直す。題でない .md (README など) は
//      GitHub の公開 URL へ。引けないものは字だけ残して数える
//      同じ階層の相対画像は、PNG などは添付に取り込み、SVG (QR Note は添付にできない) は
//      Pages の公開 URL へ
//   6. 32,000 文字を超える題は `## ` の見出しで分ける
//   7. 作成・更新日時は**古い固定日** (既定 2000-01-01。第 4 引数で替えられる) にする。
//      取り込んだ時刻のままだと、一覧の更新順の先頭を教科書が占め、自分のメモが埋もれる
//      (562 件を入れた手元の確かめで、先頭 20 件が全部教科書になった)。タグで絞れば出る
//   8. 冊の README の目次 (`<!-- toc:start -->` 〜 `toc:end`) を目次ノート `wb<冊>-00-00` にする。
//      書いていない題 (リンクの無い行) は外す。題へのリンクには冊のタグと番号順の検索状態を
//      付け、開いた題に前後ナビが出るようにする (前後ナビは q のあるときだけ出る)
//
// 総目次 (冊の目次ノートへのリンクの表) は、冊の代わりに `index` を渡すと 1 件だけの ZIP にする。
// `index:04-denken,01-circuits` のように冊を挙げると、挙げた冊だけをリンクにし、残りは字だけ
// にする (まだ取り込んでいない冊の番号を開くと、未登録の番号の画面になるため)。
// 冊を足したら、総目次を作り直して overwrite で入れる:
//   node scripts/convertWorkbookToZip.mjs ~/52-tommie-fence/tommie-circuit-workbook index:04-denken _del/wb-00.zip
//
// itemNo は `wb<冊>-<章>-<題>` (例 wb04-06-01)。QR Note の itemNo は英数字・`_`・`-` の
// 20 字までの文字列なので、番号を振らずに題の位置をそのまま名前にする。リンクの貼り直しが要らない。
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { zipSync, strToU8 } from 'fflate'

const [root, book, outPath, dateArg] = process.argv.slice(2)
const STAMP = `${dateArg ?? '2000-01-01'}T00:00:00.000Z`
if (Number.isNaN(Date.parse(STAMP))) {
  console.error(`日付が読めません: ${dateArg}`)
  process.exit(2)
}
if (!root || !book || !outPath) {
  console.error('usage: node scripts/convertWorkbookToZip.mjs <教科書> <冊> <出力.zip>')
  process.exit(2)
}

const SUPPORTED = new Set([
  'circuit', 'circuitikz', 'breadboard', 'bread', 'perfboard', 'perf',
  'vna', 'scope', 'spectrum', 'graph', 'logic', 'copper', 'mermaid',
])
const ALIASES = new Map([['bread', 'breadboard'], ['perf', 'perfboard']])
const DATA_FENCES = new Set(['vna', 'scope', 'spectrum', 'graph'])
const DATA_EXT = new Set(['.csv', '.s1p', '.s2p', '.txt'])
const MAX_CHARS = 32000
const SPLIT_TARGET = 28000
const PAGES_IMAGE = /^!\[[^\]]*\]\(https:\/\/tommie-jp\.github\.io\/tommie-circuit-workbook\/[^)]+\)\s*$/
const REL_LINK = /\]\(([^)\s#]+\.md)(#[^)\s]*)?\)/g
const REL_IMAGE = /!\[([^\]]*)\]\((?!https?:|\/|data:)([^)\s]+)\)/g
const RASTER_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const PAGES_BASE = 'https://tommie-jp.github.io/tommie-circuit-workbook/'
const GITHUB_BLOB = 'https://github.com/tommie-jp/tommie-circuit-workbook/blob/main/'

const report = { notes: 0, parts: 0, removedImages: 0, keptImages: 0, aliases: 0, data: 0, dataMissing: [], links: 0, linksDropped: [], relImages: [], split: [], imagesAttached: 0, imagesToPages: 0 }

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name === 'out' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (name.endsWith('.md') && name !== 'README.md') yield p
  }
}

const num = (s) => (/^(\d+)/.exec(s) ?? [])[1] ?? '00'
function itemNoOf(file) {
  const rel = relative(join(root, book), file).split('/')
  const bookNo = num(book)
  const chapter = rel.length > 1 ? num(rel[0]) : '00'
  return `wb${bookNo}-${chapter}-${num(basename(file))}`
}

const BOOKS = readdirSync(root).filter((n) => /^0\d-/.test(n)).sort()
const indexMatch = /^index(?::(.*))?$/.exec(book)
const linkedBooks = indexMatch === null ? null : new Set(indexMatch[1] ? indexMatch[1].split(',') : BOOKS)
for (const b of linkedBooks ?? [book]) {
  if (!BOOKS.includes(b)) {
    console.error(`冊がありません: ${b}`)
    process.exit(2)
  }
}

// 前もって全題の対応表を作る (リンクの貼り替えに要る)
const files = indexMatch === null ? [...walk(join(root, book))] : []
const idByPath = new Map(files.map((f) => [resolve(f), itemNoOf(f)]))
// 他の冊への参照も同じ規則で引けるように、教科書全体の表を足す
for (const b of BOOKS) {
  for (const f of walk(join(root, b))) {
    const rel = relative(join(root, b), f).split('/')
    idByPath.set(resolve(f), `wb${num(b)}-${rel.length > 1 ? num(rel[0]) : '00'}-${num(basename(f))}`)
  }
}

const uuidOf = (key) => {
  const h = createHash('sha1').update(key).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const attachments = new Map() // zip のパス → bytes
const notes = []

function stripFrontmatter(text) {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text)
  return m ? text.slice(m[0].length) : text
}

function convert(file) {
  const dir = dirname(file)
  const itemNo = itemNoOf(file)
  const lines = stripFrontmatter(readFileSync(file, 'utf8')).replace(/\r\n/g, '\n').split('\n')
  const out = []
  let fence = null // { marker, lang }
  let lastFenceLang = null // 直前に閉じたフェンスの言語 (画像行の判定)
  const usedData = new Set()
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const open = /^(\s*)(`{3,}|~{3,})\s*([\w-]*)/.exec(line)
    if (fence === null && open) {
      let lang = open[3]
      let text = line
      if (ALIASES.has(lang)) {
        text = line.replace(lang, ALIASES.get(lang))
        lang = ALIASES.get(lang)
        report.aliases += 1
      }
      // data: を持つフェンスは、閉じまで先読みして添付を前に置く
      if (DATA_FENCES.has(lang)) {
        for (let j = i + 1; j < lines.length && !/^\s*(`{3,}|~{3,})\s*$/.test(lines[j]); j += 1) {
          const d = /^data:\s*(\S+)/.exec(lines[j])
          if (!d || usedData.has(d[1])) continue
          usedData.add(d[1])
          const name = d[1]
          const p = resolve(dir, name)
          if (name.includes('/') || !DATA_EXT.has(extname(name).toLowerCase()) || !existsSync(p)) {
            report.dataMissing.push(`${relative(root, file)}: ${name}`)
            continue
          }
          const stored = `${uuidOf(`${relative(root, p)}`)}${extname(name).toLowerCase()}`
          attachments.set(`images/${stored}`, readFileSync(p))
          out.push(`![${name}](../images/${stored})`, '')
          report.data += 1
        }
      }
      fence = { marker: open[2][0], len: open[2].length, lang }
      out.push(text)
      lastFenceLang = null
      continue
    }
    if (fence !== null) {
      out.push(line)
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)
      if (close && close[1][0] === fence.marker && close[1].length >= fence.len) {
        lastFenceLang = fence.lang
        fence = null
      }
      continue
    }
    // フェンスの外
    if (PAGES_IMAGE.test(line)) {
      if (lastFenceLang !== null && SUPPORTED.has(lastFenceLang)) {
        report.removedImages += 1
        // 画像行の前後の空行を 1 つにまとめる
        if (out.length > 0 && out[out.length - 1] === '' && lines[i + 1] === '') i += 1
        continue
      }
      report.keptImages += 1
      out.push(line)
      continue
    }
    if (line.trim() !== '') lastFenceLang = null
    let next = line.replace(REL_LINK, (whole, target, hash) => {
      // 書いた題のある所からの相対パスを先に、無ければ教科書の根からの相対パス
      // (`04-denken/…/x.md`)。章の名前 (`00-tools/`) と冊の名前が同じ形なので、
      // 形では決めず、引けたほうを採る
      const id = idByPath.get(resolve(dir, target)) ?? idByPath.get(resolve(root, target))
      if (id === undefined) {
        // 題でない .md (README など) は GitHub の公開 URL にする。無ければ字だけ残す
        const abs = [resolve(dir, target), resolve(root, target)].find((p) => existsSync(p))
        if (abs !== undefined && abs.startsWith(resolve(root) + '/')) {
          report.links += 1
          return `](${GITHUB_BLOB}${relative(root, abs)}${hash ?? ''})`
        }
        report.linksDropped.push(`${relative(root, file)}: ${target}`)
        return '](#)'
      }
      report.links += 1
      return `](/item/${id}${hash ?? ''})`
    })
    // 引けなかったリンク `[字](#)` は字だけに戻す
    next = next.replace(/\[([^\]]+)\]\(#\)/g, '$1')
    next = next.replace(REL_IMAGE, (whole, alt, target) => {
      const abs = resolve(dir, target)
      if (!existsSync(abs) || !abs.startsWith(resolve(root) + '/')) {
        report.relImages.push(`${relative(root, file)}: ${target} (見つからない)`)
        return whole
      }
      const ext = extname(abs).toLowerCase()
      if (RASTER_EXT.has(ext)) {
        const stored = `${uuidOf(relative(root, abs))}${ext === '.jpeg' ? '.jpg' : ext}`
        attachments.set(`images/${stored}`, readFileSync(abs))
        report.imagesAttached += 1
        return `![${alt}](../images/${stored})`
      }
      report.imagesToPages += 1
      return `![${alt}](${PAGES_BASE}${relative(root, abs)})`
    })
    out.push(next)
  }
  return { itemNo, body: out.join('\n').replace(/\n{3,}/g, '\n\n').trim() }
}

const ROOT_TAG = 'tommie-circuit-workbook'
const tagOf = (b) => `wb-${b.replace(/^\d+-/, '')}`
const bookTag = tagOf(book)
function tagLine() {
  return indexMatch === null ? `#${ROOT_TAG} #${bookTag}` : `#${ROOT_TAG}`
}

// 目次ノート (決め 8)。冊のタグで番号順に並べると、目次 → 0-1 → 0-2 … の順に前後ナビで辿れる
const tocItemNo = (b) => `wb${num(b)}-00-00`
const INDEX_ITEM_NO = 'wb00-00-00'
const listQuery = (tag) => `?q=${encodeURIComponent(`#${tag}`)}&sort=itemNo`
const TOC_START = '<!-- toc:start -->'
const TOC_END = '<!-- toc:end -->'

function readmeOf(b) {
  const text = readFileSync(join(root, b, 'README.md'), 'utf8').replace(/\r\n/g, '\n')
  const s = text.indexOf(TOC_START)
  const e = text.indexOf(TOC_END)
  if (s < 0 || e < s) throw new Error(`${b}/README.md に目次の区間がありません`)
  return { title: (/^#\s+(.*)$/m.exec(text) ?? [])[1] ?? b, toc: text.slice(s + TOC_START.length, e) }
}

// 総目次の表 (教科書の根の README) から、冊ごとの「内容」の欄を引く
function bookSummaries() {
  const { toc } = readmeOf('.')
  const map = new Map()
  for (const m of toc.matchAll(/^\| \[[^\]]+\]\((0\d-[^/]+)\/README\.md\) \| ([^|]+) \|/gm)) map.set(m[1], m[2].trim())
  return map
}

// 章の表から、書いていない題の行 (リンクの無い行) と、題が 1 つも無い章を外す
function tocChapters(b) {
  const dir = join(root, b)
  const chapters = readmeOf(b).toc.split(/\n(?=## )/).filter((c) => c.startsWith('## '))
  const out = []
  for (const chapter of chapters) {
    const lines = chapter.trim().split('\n')
    let rows = 0
    const kept = lines.filter((line) => {
      if (!/^\| \d/.test(line)) return true
      if (!/\]\([^)]+\.md\)/.test(line)) return false
      rows += 1
      return true
    })
    if (rows === 0) continue
    out.push(
      kept
        .map((line) =>
          line.replace(REL_LINK, (whole, target) => {
            const id = idByPath.get(resolve(dir, target))
            if (id === undefined) {
              report.linksDropped.push(`${b}/README.md: ${target}`)
              return whole
            }
            report.links += 1
            return `](/item/${id}${listQuery(tagOf(b))})`
          }),
        )
        .join('\n'),
    )
  }
  return out
}

function bookTocNote() {
  const { title } = readmeOf(book)
  const summary = bookSummaries().get(book)
  const body = [
    `# ${title} — 目次`,
    ...(summary ? [summary] : []),
    `[総目次](/item/${INDEX_ITEM_NO})`,
    ...tocChapters(book),
  ].join('\n\n')
  return { itemNo: tocItemNo(book), memo: `${body}\n\n${tagLine()}` }
}

function splitBody(itemNo, body) {
  const full = `${body}\n\n${tagLine()}`
  if (full.length <= MAX_CHARS) return [{ itemNo, memo: full }]
  const sections = body.split(/\n(?=## )/)
  const chunks = []
  let cur = ''
  for (const s of sections) {
    if (cur !== '' && (cur + '\n' + s).length > SPLIT_TARGET) {
      chunks.push(cur)
      cur = s
    } else {
      cur = cur === '' ? s : `${cur}\n${s}`
    }
  }
  if (cur !== '') chunks.push(cur)
  const title = (/^#\s+(.*)$/m.exec(body) ?? [])[1] ?? itemNo
  const ids = chunks.map((_, k) => (k === 0 ? itemNo : `${itemNo}${String.fromCharCode(97 + k)}`))
  report.split.push(`${itemNo}: ${chunks.length} 分割 (${body.length} 字)`)
  return chunks.map((c, k) => {
    let text = c
    if (k === 0) text = text.replace(/^#\s+(.*)$/m, `# $1 (1/${chunks.length})`)
    else text = `# ${title} (${k + 1}/${chunks.length})\n\n${text}`
    const nav = chunks.map((_, j) => (j === k ? `(${j + 1}/${chunks.length})` : `[(${j + 1}/${chunks.length})](/item/${ids[j]})`)).join(' ')
    return { itemNo: ids[k], memo: `${text}\n\n${nav}\n\n${tagLine()}` }
  })
}

// 総目次。冊の目次ノートへのリンクの表。取り込んでいない冊は字だけにする
function indexNote() {
  const { title } = readmeOf('.')
  const warning = (/^>.*(?:\n>.*)*/m.exec(readFileSync(join(root, 'README.md'), 'utf8').replace(/\r\n/g, '\n')) ?? [''])[0]
  const summaries = bookSummaries()
  const rows = BOOKS.map((b) => {
    const name = readmeOf(b).title
    const cell = linkedBooks.has(b) ? `[${name}](/item/${tocItemNo(b)})` : `${name} (未取り込み)`
    return `| ${cell} | ${summaries.get(b) ?? ''} | ${[...walk(join(root, b))].length} |`
  })
  const body = [
    `# ${title} — 総目次`,
    ...(warning ? [warning] : []),
    ['| 冊 | 内容 | 題 |', '| --- | --- | --- |', ...rows].join('\n'),
  ].join('\n\n')
  return { itemNo: INDEX_ITEM_NO, memo: `${body}\n\n${tagLine()}` }
}

if (indexMatch !== null) notes.push(indexNote())
else notes.push(bookTocNote())

for (const file of files) {
  const { itemNo, body } = convert(file)
  const parts = splitBody(itemNo, body)
  report.notes += 1
  report.parts += parts.length
  for (const p of parts) notes.push(p)
}

const zipFiles = {}
for (const n of notes) {
  if (n.memo.length > MAX_CHARS) console.error(`WARN 長すぎる: ${n.itemNo} (${n.memo.length} 字)`)
  zipFiles[`notes/${n.itemNo}.md`] = strToU8(
    `---\nitemNo: ${JSON.stringify(n.itemNo)}\nmode: memo\nurl: ""\ncreated: ${STAMP}\nupdated: ${STAMP}\npublic: false\n---\n${n.memo}\n`,
  )
}
for (const [path, bytes] of attachments) zipFiles[path] = new Uint8Array(bytes)
writeFileSync(outPath, zipSync(zipFiles))
console.log(JSON.stringify({ book, ...report, attachments: attachments.size, linksDropped: report.linksDropped.length, dataMissing: report.dataMissing.length, relImages: report.relImages.length }, null, 1))
for (const k of ['linksDropped', 'dataMissing', 'relImages']) if (report[k].length) console.log(`-- ${k} (先頭 8 件)\n` + report[k].slice(0, 8).join('\n'))
for (const s of report.split) console.log('split', s)
