import { describe, expect, test } from 'vitest'
import {
  ACCEPTED_FILE_TYPES,
  attachmentAlt,
  attachmentAltText,
  attachmentKind,
  ignoredFilesMessage,
  isAudioFile,
  isPdfFile,
  isTextFile,
  isVideoFile,
  pickFiles,
  shouldMakeThumbs,
} from './attachmentKinds'

const file = (name: string, type = '') => new File(['x'], name, { type })

const ALTS = { audio: 'audio', video: 'video', image: '' }

describe('ACCEPTED_FILE_TYPES', () => {
  // HEIC は MIME を空で送る端末があるので、拡張子でも選べなければならない
  test('画像は MIME と拡張子の両方で絞り込む', () => {
    // Act
    const accepted = ACCEPTED_FILE_TYPES.split(',')

    // Assert
    expect(accepted).toContain('image/heic')
    expect(accepted).toContain('.heic')
  })

  // iOS の file picker は .md に UTI が無く、text/plain が無いと選べない
  test('テキストは text/plain も併記する', () => {
    expect(ACCEPTED_FILE_TYPES.split(',')).toContain('text/plain')
  })

  test('音声・動画・PDF の受け口がすべて入っている', () => {
    // Act
    const accepted = ACCEPTED_FILE_TYPES.split(',')

    // Assert
    for (const item of ['audio/x-m4a', '.webm', 'video/quicktime', '.3gp', 'application/pdf', '.md']) {
      expect(accepted).toContain(item)
    }
  })
})

describe('入力ファイルの判定', () => {
  test('音声は MIME か拡張子で拾う', () => {
    expect(isAudioFile(file('rec', 'audio/mp4'))).toBe(true)
    expect(isAudioFile(file('voice.M4A'))).toBe(true)
    expect(isAudioFile(file('movie.mp4'))).toBe(false)
  })

  // 入力側は .webm や .3gp も拾う (保存名の拡張子とは別)
  test('動画は MIME か入力の拡張子で拾う', () => {
    expect(isVideoFile(file('clip', 'video/webm'))).toBe(true)
    expect(isVideoFile(file('clip.3gp'))).toBe(true)
    expect(isVideoFile(file('song.mp3'))).toBe(false)
  })

  // .webm は音声と拡張子を共有するので、名前だけではサムネを作りに行かない
  test('サムネを作るのは MIME が video/* のときだけ', () => {
    expect(shouldMakeThumbs(file('clip.webm', 'video/webm'))).toBe(true)
    expect(shouldMakeThumbs(file('clip.webm'))).toBe(false)
    expect(shouldMakeThumbs(file('voice.webm', 'audio/webm'))).toBe(false)
  })

  test('PDF は MIME か拡張子で拾う', () => {
    expect(isPdfFile(file('doc', 'application/pdf'))).toBe(true)
    expect(isPdfFile(file('doc.PDF'))).toBe(true)
    expect(isPdfFile(file('doc.txt', 'text/plain'))).toBe(false)
  })

  // サーバが受けるのは名前が txt/csv/md のものだけなので、MIME では広げない
  test('テキストは拡張子だけで拾う', () => {
    expect(isTextFile(file('memo.md'))).toBe(true)
    expect(isTextFile(file('noext', 'text/plain'))).toBe(false)
    expect(isTextFile(file('app.log', 'text/plain'))).toBe(false)
  })
})

describe('pickFiles', () => {
  test('対応する種類だけを順序を保って残す', () => {
    // Arrange
    const photo = file('IMG_0001.HEIC')
    const shot = file('shot', 'image/png')
    const json = file('data.json', 'application/json')
    const song = file('song.mp3')
    const note = file('note.txt')

    // Act
    const picked = pickFiles([photo, json, shot, song, note])

    // Assert
    expect(picked).toEqual([photo, shot, song, note])
  })

  test('null / undefined は空として扱う', () => {
    expect(pickFiles(null)).toEqual([])
    expect(pickFiles(undefined)).toEqual([])
  })
})

describe('ignoredFilesMessage', () => {
  test('拾わなかったファイルの名前を並べて知らせる', () => {
    // Arrange
    const png = file('a.png', 'image/png')
    const json = file('b.json')
    const log = file('c.log')
    const list = [png, json, log]

    // Act
    const message = ignoredFilesMessage(list, pickFiles(list))

    // Assert
    expect(message).toBe('対応していない形式のため挿入しませんでした: b.json、c.log')
  })

  test('全部拾えたら null', () => {
    // Arrange
    const list = [file('a.png', 'image/png')]

    // Act / Assert
    expect(ignoredFilesMessage(list, pickFiles(list))).toBeNull()
    expect(ignoredFilesMessage(null, [])).toBeNull()
  })
})

describe('attachmentKind', () => {
  test('保存後の URL の拡張子で種類を決める', () => {
    expect(attachmentKind('/api/images/a.m4a')).toBe('audio')
    expect(attachmentKind('/api/images/a.webm')).toBe('audio')
    expect(attachmentKind('/api/images/a.mkv')).toBe('video')
    expect(attachmentKind('/api/images/a.mov')).toBe('video')
    expect(attachmentKind('/api/images/a.pdf')).toBe('pdf')
    expect(attachmentKind('/api/images/a.csv')).toBe('text')
    expect(attachmentKind('/api/images/a.webp')).toBe('image')
  })
})

describe('attachmentAltText', () => {
  // `]` と改行は画像記法そのものを壊す
  test('記法を壊す文字を落とす', () => {
    expect(attachmentAltText(' [draft]\r\nplan.pdf ', 'PDF')).toBe('draftplan.pdf')
  })

  test('空になったら既定の名前を使う', () => {
    expect(attachmentAltText('[]', 'PDF')).toBe('PDF')
  })
})

describe('attachmentAlt', () => {
  test('音声・動画・画像は呼び手の alt を使う', () => {
    // Arrange
    const alts = { audio: '録音 1', video: '録画 2', image: 'お絵かき 3' }

    // Act / Assert
    expect(attachmentAlt('audio', 'rec.webm', alts)).toBe('録音 1')
    expect(attachmentAlt('video', 'clip.mp4', alts)).toBe('録画 2')
    expect(attachmentAlt('image', 'draw.png', alts)).toBe('お絵かき 3')
  })

  test('PDF・テキストは元のファイル名を残し、空なら種類の名前にする', () => {
    expect(attachmentAlt('pdf', 'manual.pdf', ALTS)).toBe('manual.pdf')
    expect(attachmentAlt('pdf', '[]', ALTS)).toBe('PDF')
    expect(attachmentAlt('text', '\n', ALTS)).toBe('テキスト')
  })
})
