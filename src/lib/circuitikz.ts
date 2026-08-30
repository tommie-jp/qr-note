import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'

// 描画の上限時間。TeX は無限ループを書けてしまい (\def\x{\x}\x)、
// node-tikzjax 側に timeout が無いため、親が殺すまで永遠に返らない
export const CIRCUIT_TIMEOUT_MS = 10_000

// キャッシュキーに混ぜるレンダラの版。
// node-tikzjax の更新やプリアンブルの変更で出力が変わったら手で上げる
// (上げ忘れると古い SVG が返り続ける)
export const RENDERER_VERSION = 'tikzjax-1.0.5-2'

// 子プロセスから拾う TeX ログの上限。エラー原因は先頭に出るので頭だけで足りる
const MAX_LOG_CHARS = 64 * 1024

// circuitikz は op amp の +/- 記号を 6pt の boldmath で組むが、TikZJax は
// 太字数式のフォント (cmmib5) を同梱しておらず、そのままでは
// "Could not find font cmmib5" で TeX ごと落ちる (オペアンプが一切描けない)。
// 太字を諦めて通常の数式フォントで組ませることで回避する。
// 変更したら RENDERER_VERSION を上げること (出力が変わるため)
const OPAMP_FONT_FIX = String.raw`\makeatletter
\long\def\pgf@circ@font@boldmath{}
\long\def\pgf@circ@font@sixbm{\fontsize{6}{7}\selectfont}
\long\def\pgf@circ@font@tenbm{\fontsize{10}{12}\selectfont}
\makeatother`

// フェンスの中身は circuitikz の本体だけを書かせ、定型のプリアンブルは
// こちらで付ける
const PREAMBLE = `\\usepackage{circuitikz}\n${OPAMP_FONT_FIX}\n\\begin{document}\n`
const POSTAMBLE = '\n\\end{document}\n'

// 図の環境が既に書かれているか。**circuitikz と tikzpicture だけを見る** —
// `\begin{scope}` のような入れ子の環境は図の外枠ではないので、これがあっても
// 外枠は要る
const HAS_PICTURE_ENV = /\\begin\{(?:circuitikz|tikzpicture)\}/

// 外枠の環境が無ければ補う。
//
// ```circuitikz というフェンス名で種類は判っているので、`\begin{circuitikz}` を
// 毎回書かせるのは冗長 (利用者の指摘)。本体だけ書けば描けるようにする。
//
// **「無ければ補う」にするのが要点で、無条件には包まない。**
//   - 既存のノートは全部この環境を含んでいる。無条件に包むと二重になって壊れる
//   - `\begin{circuitikz}[scale=1.5]` のようにオプションを付けたい人が居る
//   - 回路以外の図を tikzpicture で描いているノートがあり得る
// どれも「書いてあればそのまま通す」で両立する。
//
// キャッシュの主キー (circuitHash) は**生のソース**から作るので、この変更で
// 既存の行が無効になることはない (環境ありのソースは包まれず、出力も同じ)。
// RENDERER_VERSION を上げないのはそのため
export function withCircuitEnvironment(source: string): string {
  return HAS_PICTURE_ENV.test(source)
    ? source
    : `\\begin{circuitikz}\n${source}\n\\end{circuitikz}`
}

// 描画スクリプトは Next のバンドル対象ではなく、実行時にそのまま起動する
// (standalone へは next.config.ts の outputFileTracingIncludes で同梱)。
// child_process.fork() は Turbopack が引数を静的解析して「バンドルすべき
// モジュール」と解釈し、ビルドが Module not found で落ちる。
// spawn + stdio の 'ipc' は fork と等価に IPC が張れて、解析対象にならない
const RENDERER_SCRIPT = path.join(process.cwd(), 'scripts', 'renderCircuit.cjs')

// standalone ビルドに node-tikzjax とその依存一式 (jsdom など) を同梱させる
// ためだけの参照。描画は子プロセスが行うので、この関数は決して呼ばない。
//
// Next の tracer は静的な import() を辿ってパッケージを拾うが、実行時に
// 評価されなければ読み込みは起きない。親で普通に import すると
// 87MB / 228ms を無駄に抱えることになるため、こう書いている
// (next.config.ts の serverExternalPackages と対で機能する)
export const _traceNodeTikzjax = () => import('node-tikzjax')

export class CircuitRenderError extends Error {
  // TeX が stdout に吐いた原因 (`! Package pgfkeys Error: ...` と該当行)。
  // 例外の文言自体は原因を含まないため、表示にはこちらを使う
  readonly texLog: string

  constructor(message: string, texLog = '') {
    super(message)
    this.name = 'CircuitRenderError'
    this.texLog = texLog
  }
}

// 本文 + レンダラ版から決まる、キャッシュの主キー。
//
// **改行コードは揃えてから混ぜる** (docs/85-回路図表示待ち計画.md §6)。
// 同じ図の同じソースが、経路によって CRLF と LF の 2 通りで届く:
//   - 閲覧 … DB の本文そのまま (取り込んだファイルが CRLF ならそのまま残る)
//   - 編集のライブプレビュー … CodeMirror が読み書きする時点で LF に揃う
// TeX の出力は改行コードに依らず 1 バイトも変わらない (実測: 同じ SVG の
// md5 が一致) のに、混ぜると別の鍵になり同じ図を 2 度描いて 2 行溜める。
// いちばん高い処理を丸ごと二重に払っていた
export function circuitHash(source: string, version = RENDERER_VERSION): string {
  const normalized = source.replace(/\r\n?/g, '\n')
  return createHash('sha256').update(`${version}\n${normalized}`).digest('hex')
}

// TikZJax が実際に出力する要素。多様な回路 (抵抗・トランジスタ・op-amp・
// ダイオード・接地) で調べたところ svg / g / defs / style / path / text の
// 6 種類しか現れないが、図形系は将来出てき得るので少し広めに許す
const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'style', 'path', 'text', 'tspan', 'use', 'symbol',
  'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'clippath', 'mask', 'lineargradient', 'radialgradient', 'stop', 'marker',
  'pattern', 'title', 'desc',
])

// style の @import で参照してよい唯一の URL (自前配信のフォント)
const ALLOWED_URL = '/tikzjax/fonts.css'

// 出力 SVG が想定どおりの「絵」だけであることを確かめる。違えば描画エラーにする。
//
// uploads.ts が「SVG はスクリプトを埋め込めるため」アップロードを拒んでいる以上、
// 生成物とはいえ dangerouslySetInnerHTML に無検査で流すのは方針に反する。
//
// 危険なものを消す (ブロックリスト) のではなく、想定外なら丸ごと捨てる
// (許可リスト) 方式にしている。消す方式は書き漏らしがそのまま穴になり、
// 実際 <script/> の自己閉じタグや <set attributeName="onload"> のような
// SMIL 経由の指定を取り逃がしていた。判断に迷うものは通さない側に倒す
export function assertSafeCircuitSvg(svg: string): string {
  // タグを 1 つずつ見る。属性値の中の < > に釣られないよう、
  // 引用符で囲まれた部分をまとめて読み飛ばす
  const tags = svg.matchAll(/<\/?\s*([a-zA-Z][\w:.-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)\/?>/g)

  for (const [, name, rawAttrs] of tags) {
    if (!ALLOWED_ELEMENTS.has(name.toLowerCase())) {
      throw new CircuitRenderError(`想定外の SVG 要素 <${name}> が含まれていました`)
    }

    const attrs = rawAttrs.matchAll(
      /([a-zA-Z][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
    )
    for (const [, attr, dq, sq, bare] of attrs) {
      const attrName = attr.toLowerCase()
      const value = dq ?? sq ?? bare ?? ''

      // onload= などのイベントハンドラ
      if (attrName.startsWith('on')) {
        throw new CircuitRenderError(`想定外の SVG 属性 ${attr} が含まれていました`)
      }
      // <use href="#glyph"> のような内部参照だけを許す
      if ((attrName === 'href' || attrName.endsWith(':href')) && !value.startsWith('#')) {
        throw new CircuitRenderError(`想定外の SVG 参照 ${attr}="${value}" が含まれていました`)
      }
      if (/javascript\s*:/i.test(value)) {
        throw new CircuitRenderError('SVG に javascript: が含まれていました')
      }
    }
  }

  // <style> の中身はタグではないので上の検査に掛からない。
  // 外部を読みに行く url() が紛れ込んでいないか別途見る
  for (const [, url] of svg.matchAll(/url\(\s*['"]?([^'")]*)/gi)) {
    if (url.trim() !== ALLOWED_URL && !url.startsWith('#')) {
      throw new CircuitRenderError(`想定外の SVG 参照 url(${url}) が含まれていました`)
    }
  }

  return svg
}

// node-tikzjax はモジュールレベルの状態を持ち、README も同時実行を禁じている
// ("Don't run multiple instances at the same time")。1 本の鎖に繋いで直列化する
let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  // 前の描画が失敗しても後続は流す
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

// TeX のログから原因だけを抜く。`!` で始まる行がエラー、`l.12 ...` が該当行
function extractTexError(log: string): string {
  const lines = log
    .split('\n')
    .filter((line) => /^!/.test(line) || /^l\.\d+/.test(line))
    .map((line) => line.trimEnd())
  return (lines.length > 0 ? lines : log.split('\n').slice(-10)).join('\n').trim()
}

// circuitikz のソースを SVG に描く。失敗時は CircuitRenderError を投げる。
// 呼び出しは直列化されるため、同時に呼んでも順に処理される
export function renderCircuit(source: string): Promise<string> {
  return enqueue(() => renderOnce(`${PREAMBLE}${withCircuitEnvironment(source)}${POSTAMBLE}`))
}

// **プリアンブルを足さずに**、渡された TeX をそのまま 1 本の文書として描く。
//
// 回路 YAML フェンス (docs/91 §2) 用。compileCircuit が返す TeX は
// `\usepackage{circuitikz}` から `\end{document}` まで揃った完全な入力なので、
// 上の PREAMBLE を重ねると二重定義で落ちる。OPAMP_FONT_FIX も要らない —
// circuit-fence は cmmib5 が無い問題を `plain amp` + 手書きの ± で
// 回避済みで、こちらの細工と食い違わせないためにも触らない。
//
// 描画の待ち行列は共有する。node-tikzjax が同時実行を許さないのは
// 言語に関係なく同じで、別の列にすると 2 本同時に走ってしまう
export function renderCircuitDocument(tex: string): Promise<string> {
  return enqueue(() => renderOnce(tex))
}

// source は**完全な TeX 文書**。プリアンブルの有無は呼び出し側が決める
function renderOnce(source: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [RENDERER_SCRIPT], {
      // stdout は TeX のログ取得に使う。stdin は使わない。
      // 'ipc' を含めることで child.send / process.on('message') が使える
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })

    let log = ''
    let settled = false
    // showConsole: true で TeX のログは全部 stdout に流れてくる。
    // \loop\message{...}\repeat のような出力し続ける TeX を書かれると
    // timeout までの 10 秒で親のメモリを食い潰せるため、頭だけ取って捨てる
    // (エラー原因は先頭に出る)
    const appendLog = (chunk: Buffer) => {
      if (log.length < MAX_LOG_CHARS) {
        log += chunk.toString().slice(0, MAX_LOG_CHARS - log.length)
      }
    }
    child.stdout?.on('data', appendLog)
    child.stderr?.on('data', appendLog)

    const finish = (fn: () => void) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      // 応答済みでも子は生かしておく理由が無い。取りこぼしなく落とす
      child.kill('SIGKILL')
      fn()
    }

    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new CircuitRenderError(
            `描画が ${CIRCUIT_TIMEOUT_MS / 1000} 秒を超えたため中断しました`,
            extractTexError(log),
          ),
        ),
      )
    }, CIRCUIT_TIMEOUT_MS)

    child.on('message', (msg: { ok: boolean; svg?: string; error?: string }) => {
      finish(() => {
        if (!msg.ok || !msg.svg) {
          reject(new CircuitRenderError('回路図を描画できませんでした', extractTexError(log)))
          return
        }
        try {
          // 検査は throw するので、ここで受けないと Promise が未解決のまま残る
          resolve(assertSafeCircuitSvg(msg.svg))
        } catch (e) {
          reject(e)
        }
      })
    })

    child.on('error', (e) => {
      finish(() => reject(new CircuitRenderError(`描画プロセスを起動できません: ${e.message}`)))
    })

    // 応答を返さずに死んだ場合 (OOM kill など) もここで拾う
    child.on('exit', (code, signal) => {
      finish(() =>
        reject(
          new CircuitRenderError(
            `描画プロセスが異常終了しました (code=${code} signal=${signal})`,
            extractTexError(log),
          ),
        ),
      )
    })

    child.send({ source })
  })
}
