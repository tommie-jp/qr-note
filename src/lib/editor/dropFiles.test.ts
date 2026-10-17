import { describe, expect, test } from 'vitest'
import {
  acceptsDrop,
  droppedImageUrl,
  externalImageMarkup,
  hasDroppedFiles,
} from './dropFiles'

const ORIGIN = 'https://note.example.jp'

describe('hasDroppedFiles', () => {
  test('types に Files があれば true', () => {
    expect(hasDroppedFiles(['text/plain', 'Files'])).toBe(true)
  })

  test('文字だけのドラッグ・空・未定義は false', () => {
    expect(hasDroppedFiles(['text/plain'])).toBe(false)
    expect(hasDroppedFiles([])).toBe(false)
    expect(hasDroppedFiles(undefined)).toBe(false)
  })
})

describe('acceptsDrop', () => {
  test('ファイルと URL は受ける', () => {
    expect(acceptsDrop(['Files'])).toBe(true)
    expect(acceptsDrop(['text/uri-list', 'text/html'])).toBe(true)
  })

  test('文字だけのドラッグは受けない (本文内の移動は CodeMirror に任せる)', () => {
    expect(acceptsDrop(['text/plain'])).toBe(false)
    expect(acceptsDrop(null)).toBe(false)
  })
})

describe('droppedImageUrl', () => {
  test('<img> の src があれば拡張子が無くても採る', () => {
    // Arrange
    const links = {
      uriList: 'https://cdn.example.com/page',
      imgSrc: 'https://cdn.example.com/photo?w=800',
    }

    // Act
    const url = droppedImageUrl(links, ORIGIN)

    // Assert
    expect(url).toBe('https://cdn.example.com/photo?w=800')
  })

  test('<img> が無ければ画像の拡張子を持つ URL だけ採る', () => {
    expect(
      droppedImageUrl({ uriList: 'https://example.com/a/pic.PNG', imgSrc: null }, ORIGIN),
    ).toBe('https://example.com/a/pic.PNG')
    expect(
      droppedImageUrl({ uriList: 'https://example.com/article', imgSrc: null }, ORIGIN),
    ).toBeNull()
  })

  test('uri-list のコメント行と空行は飛ばして最初の URL を読む', () => {
    // Arrange
    const uriList = '# dragged\r\n\r\nhttps://example.com/x.jpg\r\nhttps://example.com/y.jpg'

    // Act
    const url = droppedImageUrl({ uriList, imgSrc: null }, ORIGIN)

    // Assert
    expect(url).toBe('https://example.com/x.jpg')
  })

  test('同じオリジンの画像は採らない (本文内の添付を動かすドラッグ)', () => {
    expect(
      droppedImageUrl(
        { uriList: `${ORIGIN}/api/images/a.webp`, imgSrc: `${ORIGIN}/api/images/a.webp` },
        ORIGIN,
      ),
    ).toBeNull()
  })

  test('data: と blob: と壊れた URL は採らない', () => {
    expect(droppedImageUrl({ uriList: '', imgSrc: 'data:image/png;base64,AAAA' }, ORIGIN)).toBeNull()
    expect(droppedImageUrl({ uriList: '', imgSrc: 'blob:https://x/1' }, ORIGIN)).toBeNull()
    expect(droppedImageUrl({ uriList: 'not a url.png', imgSrc: null }, ORIGIN)).toBeNull()
    expect(droppedImageUrl({ uriList: '', imgSrc: null }, ORIGIN)).toBeNull()
  })
})

describe('externalImageMarkup', () => {
  test('丸括弧を % にして記法を壊さない', () => {
    expect(externalImageMarkup('https://example.com/a_(1).png')).toBe(
      '![](https://example.com/a_%281%29.png)',
    )
  })
})
