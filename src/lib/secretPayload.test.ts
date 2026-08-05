import { describe, expect, test } from 'vitest'
import {
  MAX_SECRET_BYTES,
  MAX_SECRET_VIDEO_BYTES,
  SECRET_TEXT_MIME,
  checkSecretPayload,
  isSecretImageMime,
  isSecretMime,
  normalizeSecretMime,
  secretMimeKind,
} from './secretPayload'

describe('isSecretMime', () => {
  test('accepts the fragment body, images, audio and video', () => {
    expect(isSecretMime(SECRET_TEXT_MIME)).toBe(true)
    expect(isSecretMime('image/webp')).toBe(true)
    expect(isSecretMime('image/jpeg')).toBe(true)
    expect(isSecretMime('audio/webm')).toBe(true)
    expect(isSecretMime('audio/mp4')).toBe(true)
    expect(isSecretMime('video/webm')).toBe(true)
    expect(isSecretMime('video/mp4')).toBe(true)
    expect(isSecretMime('video/quicktime')).toBe(true)
  })

  test('rejects anything else (未知の mime を溜め込まない)', () => {
    expect(isSecretMime('text/html')).toBe(false)
    expect(isSecretMime('application/pdf')).toBe(false)
    expect(isSecretMime('image/svg+xml')).toBe(false)
    expect(isSecretMime('')).toBe(false)
  })
})

describe('isSecretImageMime', () => {
  test('separates images from the other kinds', () => {
    expect(isSecretImageMime('image/png')).toBe(true)
    expect(isSecretImageMime(SECRET_TEXT_MIME)).toBe(false)
    expect(isSecretImageMime('audio/webm')).toBe(false)
  })
})

describe('secretMimeKind', () => {
  test('tells the four kinds apart (表示の振り分けに使う)', () => {
    expect(secretMimeKind(SECRET_TEXT_MIME)).toBe('text')
    expect(secretMimeKind('image/png')).toBe('image')
    expect(secretMimeKind('audio/mp4')).toBe('audio')
    expect(secretMimeKind('video/webm')).toBe('video')
  })

  test('returns null for anything unknown', () => {
    expect(secretMimeKind('application/pdf')).toBe(null)
  })
})

describe('normalizeSecretMime', () => {
  test('drops the codecs parameter MediaRecorder adds', () => {
    expect(normalizeSecretMime('audio/webm;codecs=opus')).toBe('audio/webm')
    expect(normalizeSecretMime('video/webm; codecs="vp9,opus"')).toBe('video/webm')
  })

  test('lowercases and trims (申告をそのまま鵜呑みにしない)', () => {
    expect(normalizeSecretMime(' Audio/MP4 ')).toBe('audio/mp4')
  })

  test('leaves a plain mime alone', () => {
    expect(normalizeSecretMime('image/png')).toBe('image/png')
  })
})

describe('checkSecretPayload', () => {
  test('accepts a normal payload', () => {
    expect(checkSecretPayload(SECRET_TEXT_MIME, 100)).toBe(null)
  })

  test('rejects an unknown mime with 400', () => {
    expect(checkSecretPayload('text/html', 100)?.status).toBe(400)
  })

  test('rejects an empty body (エンベロープの体を成さない)', () => {
    expect(checkSecretPayload(SECRET_TEXT_MIME, 0)?.status).toBe(400)
  })

  test('rejects an oversized body with 413', () => {
    expect(checkSecretPayload('image/png', MAX_SECRET_BYTES + 1)?.status).toBe(413)
  })

  test('gives video a larger allowance than the rest (uploads.ts と同じ分け方)', () => {
    const overImage = MAX_SECRET_BYTES + 1
    expect(checkSecretPayload('video/mp4', overImage)).toBe(null)
    expect(checkSecretPayload('image/png', overImage)?.status).toBe(413)
    expect(checkSecretPayload('video/mp4', MAX_SECRET_VIDEO_BYTES + 1)?.status).toBe(
      413,
    )
  })
})
