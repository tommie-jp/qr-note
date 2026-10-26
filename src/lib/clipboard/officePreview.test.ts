import { strToU8, zipSync } from 'fflate'
import { describe, expect, test } from 'vitest'
import { OFFICE_XML_MAX_BYTES, officePreview } from './officePreview'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

const zip = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))

describe('officePreview (Office の本文の抜粋)', () => {
  test('docx は段落ごとに改行し、タグを落とす', () => {
    const docx = zip({
      'word/document.xml':
        '<w:document><w:body><w:p><w:r><w:t>議事録</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t xml:space="preserve">出席: </w:t></w:r><w:r><w:t>山田</w:t></w:r></w:p></w:body></w:document>',
    })

    expect(officePreview(docx, DOCX)).toBe('議事録\n出席: 山田')
  })

  test('xlsx は共有文字列を 1 行ずつ', () => {
    const xlsx = zip({
      'xl/sharedStrings.xml': '<sst><si><t>名前</t></si><si><t>点数</t></si><si><r><t>A</t></r><r><t>B</t></r></si></sst>',
    })

    expect(officePreview(xlsx, XLSX)).toBe('名前\n点数\nAB')
  })

  test('pptx は 1 枚目のスライド', () => {
    const pptx = zip({
      'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>表題</a:t></a:r></a:p><a:p><a:r><a:t>副題</a:t></a:r></a:p></p:sld>',
      'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>2 枚目</a:t></a:r></a:p></p:sld>',
    })

    expect(officePreview(pptx, PPTX)).toBe('表題\n副題')
  })

  test('文字参照をほどく', () => {
    const docx = zip({
      'word/document.xml': '<w:p><w:t>a &amp; b &lt;c&gt; &quot;d&quot; &#x3042;&#12354;</w:t></w:p>',
    })

    expect(officePreview(docx, DOCX)).toBe('a & b <c> "d" ああ')
  })

  test('長い本文は 4 行・300 字の抜粋にする', () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) => `<w:p><w:t>行${i}</w:t></w:p>`).join('')

    expect(officePreview(zip({ 'word/document.xml': paragraphs }), DOCX)).toBe('行0\n行1\n行2\n行3…')
  })

  test.each([
    ['壊れた zip', new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])],
    ['目当ての XML が無い', zip({ 'other.xml': '<a/>' })],
    ['本文が空', zip({ 'word/document.xml': '<w:document/>' })],
  ])('%s は null', (_name, bytes) => {
    expect(officePreview(bytes, DOCX)).toBeNull()
  })

  test('Office でない mime は null', () => {
    expect(officePreview(zip({ 'word/document.xml': '<w:t>x</w:t>' }), 'application/zip')).toBeNull()
  })

  // 解凍爆弾よけ: 展開後が大きい XML は読まない (宣言サイズで判定し、fflate は宣言で打ち切る)
  test('展開後が上限を超える XML は読まない', () => {
    const big = zipSync({ 'word/document.xml': new Uint8Array(OFFICE_XML_MAX_BYTES + 1) })

    expect(officePreview(big, DOCX)).toBeNull()
  })

  // ReDoS よけ: `>` の来ない `<` の長い連なりで、タグを落とす正規表現が二乗時間にならない
  test('`<` だけを 2MB 並べた本文でもすぐ返る', () => {
    const docx = zipSync({ 'word/document.xml': strToU8('<'.repeat(OFFICE_XML_MAX_BYTES)) })

    const started = Date.now()
    officePreview(docx, DOCX)

    expect(Date.now() - started).toBeLessThan(1000)
  })
})
