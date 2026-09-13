import 'server-only'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { assertSafeCircuitSvg } from './circuit/hash'
import { CircuitRenderError } from './circuit/renderError'

// 描画の上限時間。TeX は無限ループを書けてしまい (\def\x{\x}\x)、
// node-tikzjax 側に timeout が無いため、親が殺すまで永遠に返らない
export const CIRCUIT_TIMEOUT_MS = 10_000

// 子プロセスから拾う TeX ログの上限。エラー原因は先頭に出るので頭だけで足りる
const MAX_LOG_CHARS = 64 * 1024

// circuitikz は op amp の +/- 記号を 6pt の boldmath で組むが、TikZJax は
// 太字数式のフォント (cmmib5) を同梱しておらず、そのままでは
// "Could not find font cmmib5" で TeX ごと落ちる (オペアンプが一切描けない)。
// 太字を諦めて通常の数式フォントで組ませることで回避する。
// 変更したら RENDERER_VERSION (circuit/hash.ts) を上げること (出力が変わるため)
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
