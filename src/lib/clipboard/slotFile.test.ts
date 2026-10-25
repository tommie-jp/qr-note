import { describe, expect, test } from 'vitest'
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from '../uploads/limits'
import {
  JPEG_HEAD,
  mp4WithHandlers,
  PNG_HEAD,
  webmFile,
} from '../uploads/sniff/__fixtures__/media'
import { classifySlotFile } from './slotFile'

const pad = (head: Uint8Array, size = 32): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(size)
  out.set(head)
  return out
}
const ascii = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text)

describe('classifySlotFile: 中身の署名で形式を決める (申告は見ない)', () => {
  test.each([
    ['png', pad(PNG_HEAD), 'image/png'],
    ['jpeg', pad(JPEG_HEAD), 'image/jpeg'],
    ['gif', pad(ascii('GIF89a')), 'image/gif'],
    ['tiff', pad(Uint8Array.from([0x49, 0x49, 0x2a, 0x00])), 'image/tiff'],
  ])('画像 %s', (_name, bytes, mime) => {
    expect(classifySlotFile(bytes, null)).toMatchObject({ mime, limit: MAX_IMAGE_BYTES })
  })

  test('webp 画像', () => {
    const webp = pad(ascii('RIFF\0\0\0\0WEBPVP8 '))
    expect(classifySlotFile(webp, null)).toMatchObject({ mime: 'image/webp' })
  })

  test('mp4 動画は 30MB まで', () => {
    const mp4 = mp4WithHandlers('isom', ['vide', 'soun']) as Uint8Array<ArrayBuffer>
    expect(classifySlotFile(mp4, null)).toMatchObject({
      mime: 'video/mp4',
      limit: MAX_VIDEO_BYTES,
    })
  })

  test('iPhone の mov 動画', () => {
    const mov = mp4WithHandlers('qt  ', ['vide', 'soun']) as Uint8Array<ArrayBuffer>
    expect(classifySlotFile(mov, null)).toMatchObject({ mime: 'video/quicktime' })
  })

  test('webm 動画', () => {
    const webm = webmFile(['V_VP9', 'A_OPUS']) as Uint8Array<ArrayBuffer>
    expect(classifySlotFile(webm, null)).toMatchObject({ mime: 'video/webm' })
  })

  // 映像トラックの無い mp4 は動画ではない (m4a 音声)
  test('音声だけの m4a は音声', () => {
    const m4a = mp4WithHandlers('M4A ', ['soun']) as Uint8Array<ArrayBuffer>
    expect(classifySlotFile(m4a, null)).toMatchObject({
      mime: 'audio/mp4',
      limit: MAX_IMAGE_BYTES,
    })
  })

  test('wav 音声', () => {
    const wav = pad(ascii('RIFF\0\0\0\0WAVEfmt '))
    expect(classifySlotFile(wav, null)).toMatchObject({ mime: 'audio/wav' })
  })

  test('PDF', () => {
    expect(classifySlotFile(pad(ascii('%PDF-1.7\n')), null)).toMatchObject({
      mime: 'application/pdf',
    })
  })

  // 名前と中身の両方が合ったときだけテキスト。HTML は名前を偽っても通さない
  test.each([
    ['memo.txt', 'text/plain; charset=utf-8'],
    ['data.csv', 'text/csv; charset=utf-8'],
    ['note.md', 'text/markdown; charset=utf-8'],
  ])('テキスト %s', (name, mime) => {
    expect(classifySlotFile(ascii('あいう,abc\n'), name)).toMatchObject({ mime })
  })

  test('テキストは UTF-8 に正規化して返す (Shift_JIS も UTF-8 へ)', () => {
    const sjis = Uint8Array.from([0x82, 0xa0, 0x82, 0xa2]) as Uint8Array<ArrayBuffer>

    const found = classifySlotFile(sjis, 'memo.txt')

    expect(new TextDecoder().decode(found?.data)).toBe('あい')
  })
})

const ZIP_HEAD = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]) as Uint8Array<ArrayBuffer>
const OLE_HEAD = Uint8Array.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0,
]) as Uint8Array<ArrayBuffer>

describe('classifySlotFile: Office 形式', () => {
  // OOXML・ODF は zip、旧 Office は OLE、RTF は文字。名前と署名が合ったときだけ既知の mime にする
  test.each([
    ['a.docx', ZIP_HEAD, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['a.xlsx', ZIP_HEAD, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['a.pptx', ZIP_HEAD, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['a.odt', ZIP_HEAD, 'application/vnd.oasis.opendocument.text'],
    ['a.doc', OLE_HEAD, 'application/msword'],
    ['a.xls', OLE_HEAD, 'application/vnd.ms-excel'],
    ['a.ppt', OLE_HEAD, 'application/vnd.ms-powerpoint'],
    ['a.rtf', ascii('{\\rtf1\\ansi hello}') as Uint8Array<ArrayBuffer>, 'application/rtf'],
    ['A.DOCX', ZIP_HEAD, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ])('%s', (name, bytes, mime) => {
    expect(classifySlotFile(bytes, name)).toMatchObject({ mime, limit: MAX_IMAGE_BYTES })
  })

  // 拡張子だけ docx で中身が違う物を、docx として配らない
  test('名前と署名が食い違えば、既知の mime にしない', () => {
    expect(classifySlotFile(pad(ascii('hello world')), 'fake.docx')?.mime).toBe(
      'application/octet-stream',
    )
  })

  test('名前の無い zip は普通のファイル', () => {
    expect(classifySlotFile(ZIP_HEAD, null)?.mime).toBe('application/octet-stream')
  })
})

describe('classifySlotFile: それ以外はダウンロード専用のファイル', () => {
  // mime は常に固定。HTML・SVG・実行ファイルでも、ブラウザが開いて実行することはない
  // (配信は attachment + nosniff + CSP sandbox)
  test.each([
    ['HTML', ascii('<html><script>alert(1)</script></html>'), 'x.html'],
    ['SVG', ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.svg'],
    ['zip', ZIP_HEAD, 'a.zip'],
    ['exe', Uint8Array.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]) as Uint8Array<ArrayBuffer>, 'a.exe'],
    ['名前の無い文字', ascii('hello'), null],
    ['知らない拡張子の文字', ascii('hello'), 'run.sh'],
    ['json', ascii('{"a":1}'), 'a.json'],
  ])('%s', (_name, bytes, fileName) => {
    expect(classifySlotFile(bytes, fileName)).toMatchObject({
      mime: 'application/octet-stream',
      data: bytes,
      limit: MAX_IMAGE_BYTES,
    })
  })

  test('空のファイルは受けない (中身が無い)', () => {
    expect(classifySlotFile(new Uint8Array(0), 'a.docx')).toBeNull()
  })

  // 名前がテキストなら、これまでどおり UTF-8 のテキストとして扱う
  test('HTML が .txt を名乗ってもテキスト (配信は text/plain 固定・nosniff)', () => {
    expect(classifySlotFile(ascii('<html></html>'), 'x.txt')?.mime).toBe('text/plain; charset=utf-8')
  })
})
