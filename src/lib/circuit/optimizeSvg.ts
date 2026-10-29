// 描いた回路図の SVG を保存する前に軽くする (docs/124 §2)。
//
// node-tikzjax は描くときに svgo を通しているが、座標に浮動小数の誤差
// (`-42.232000000000006`) が残っている。小数 2 桁に丸めると、手元の 689 枚で
// 圧縮後の大きさが 12% 減り、2 倍の解像度で描いた画素の差は 0.013% だった
// (座標の単位は TeX の pt で、0.01pt は画面では見えない)。
//
// **形は変えない。** 後から正規表現で SVG を読む処理がある (circuit-fence の
// 字体の埋め込みは <text> ごとの font-family を拾う・刻印は <svg> の
// data-circuit-fence)。属性をグループへ寄せる・要素をまとめる類の書き換えは
// 止め、数の丸めと空白の詰めだけに絞る。
//
// 軽くできなかった (例外・安全検査に落ちた) ときは元の SVG を返す。図は
// キャッシュ (派生データ) で、軽くできないことで図が出なくなるほうが困る
import 'server-only'
import { optimize, type Config } from 'svgo'
import { assertSafeCircuitSvg } from './hash'

export const SVG_FLOAT_PRECISION = 2

const CONFIG: Config = {
  multipass: true,
  floatPrecision: SVG_FLOAT_PRECISION,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          // 一覧のサムネは viewBox で枠に合わせる (globals.css の .circuit-thumb)
          removeViewBox: false,
          cleanupIds: false,
          // <text> の font-family を残す (字体の埋め込みが要素ごとに拾う)
          moveElemsAttrsToGroup: false,
          moveGroupAttrsToElems: false,
          collapseGroups: false,
          mergePaths: false,
          // <style>@import url(/tikzjax/fonts.css)</style> を触らない
          minifyStyles: false,
          inlineStyles: false,
        },
      },
    },
  ],
}

export function optimizeCircuitSvg(svg: string): string {
  try {
    const optimized = optimize(svg, CONFIG).data
    // 刻印と字体の @import を落としていたら使わない (形が変わった印)
    if (svg.includes('data-circuit-fence') && !optimized.includes('data-circuit-fence')) {
      return svg
    }
    if (svg.includes('@import') && !optimized.includes('@import')) {
      return svg
    }
    return assertSafeCircuitSvg(optimized)
  } catch (error) {
    console.warn('回路図の SVG を軽くできませんでした (元のまま控える)', error)
    return svg
  }
}

// まだ軽くしていない SVG か。node-tikzjax の出力は小数 3 桁で、軽くした後は
// 2 桁以下になる。図の中の文字 (素子の値「1.234」など) に当たって軽くした後も
// 当たることはあるが、もう一度軽くしても同じ物になるだけ (冪等)
export const UNOPTIMIZED_SVG_PATTERN = '[0-9]\\.[0-9]{3}'
