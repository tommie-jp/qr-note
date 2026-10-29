import { describe, expect, test } from 'vitest'
import { optimizeCircuitSvg, UNOPTIMIZED_SVG_PATTERN } from './optimizeSvg'

// 回路図の SVG を控える前に軽くする (docs/124 §2)。数を丸めることと、後から
// 正規表現で読まれる形 (刻印・字体・@import・viewBox) を残すことを固定する

const SVG = [
  '<svg data-circuit-fence="0.38.1" xmlns="http://www.w3.org/2000/svg" width="120.123456" height="80" viewBox="-72 -72 120.123456 80">',
  '<defs><style>@import url(/tikzjax/fonts.css);</style></defs>',
  '<g stroke="currentColor" stroke-width=".8">',
  '<path d="M-42.232000000000006-24.071l10.5 0" fill="none"/>',
  '<text x="-42.892" y="-24.071" font-family="cmr7" font-size="7">R1</text>',
  '<text x="-12.892" y="-24.071" font-family="cmr7" font-size="7">C1</text>',
  '</g></svg>',
].join('')

describe('optimizeCircuitSvg', () => {
  test('座標を小数 2 桁に丸め、小さくする', () => {
    // Act
    const out = optimizeCircuitSvg(SVG)

    // Assert
    expect(out.length).toBeLessThan(SVG.length)
    expect(out).not.toMatch(/\d\.\d{3}/)
    expect(out).toContain('-42.23')
  })

  test('刻印・viewBox・@import・<text> ごとの font-family を残す', () => {
    // Act
    const out = optimizeCircuitSvg(SVG)

    // Assert
    expect(out).toContain('data-circuit-fence="0.38.1"')
    expect(out).toContain('viewBox=')
    expect(out).toContain('@import url(/tikzjax/fonts.css)')
    expect(out.match(/<text\b[^>]*font-family="cmr7"/g)).toHaveLength(2)
  })

  test('2 回掛けても同じ (冪等)', () => {
    // Act
    const once = optimizeCircuitSvg(SVG)

    // Assert
    expect(optimizeCircuitSvg(once)).toBe(once)
  })

  test('安全検査に落ちる SVG は元のまま返す (軽くできないことで図を落とさない)', () => {
    // Arrange: 検査は <script> を断る
    const unsafe = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'

    // Act / Assert
    expect(optimizeCircuitSvg(unsafe)).toBe(unsafe)
  })

  test('まだ軽くしていない印は小数 3 桁の数', () => {
    // Act / Assert
    const re = new RegExp(UNOPTIMIZED_SVG_PATTERN)
    expect(re.test(SVG)).toBe(true)
    expect(re.test(optimizeCircuitSvg(SVG))).toBe(false)
  })
})
