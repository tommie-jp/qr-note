// circuitikz を SVG に描く子プロセス。1 リクエストだけ処理して終了する。
//
// 親 (src/lib/circuit/circuitikz.ts) から fork される。ここを別プロセスに切り離すのは
// 2 つの理由による:
//   1. TeX の無限ループ (\def\x{\x}\x) は tex2svg では止められず、
//      外から SIGKILL する以外に停止手段が無い
//   2. 描画中のピーク RSS が 400MB 近くに達する。プロセスごと終われば
//      OS がすべて回収する (スレッドだと本体に居座る)
//
// Next.js のバンドル対象に入れないため、素の CommonJS のまま置いている。
// standalone 出力には next.config.ts の outputFileTracingIncludes で同梱する。
const tex2svg = require('node-tikzjax').default

// 出力 SVG が参照する Computer Modern webfont の配信元。
// 既定値は jsDelivr の CDN なので、自前配信に差し替えて外部依存を断つ
const FONT_CSS_URL = '/tikzjax/fonts.css'

process.on('message', async ({ source }) => {
  try {
    const svg = await tex2svg(source, {
      // 例外の文言は原因を含まない。TeX の詳細は stdout に出るので、
      // 親がそれを拾ってエラー表示に使う
      showConsole: true,
      embedFontCss: true,
      fontCssUrl: FONT_CSS_URL,
    })
    process.send({ ok: true, svg })
  } catch (e) {
    process.send({ ok: false, error: e instanceof Error ? e.message : String(e) })
  }
})
