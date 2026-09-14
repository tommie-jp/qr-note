import { describe, expect, test } from 'vitest'
import { enexTooLargeMessage, MAX_ENEX_BYTES } from './enex/limits'
import { countRenumbered, looksLikeZip, tooLargeMessage } from './importReportView'
import { MAX_ZIP_BYTES, zipTooLargeMessage } from './zip/limits'

describe('looksLikeZip', () => {
  test('treats a .zip name as a ZIP whatever the case', () => {
    // Arrange & Act & Assert
    expect(looksLikeZip({ name: 'notes.zip' })).toBe(true)
    expect(looksLikeZip({ name: 'NOTES.ZIP' })).toBe(true)
  })

  test('treats anything else as ENEX', () => {
    // Arrange & Act & Assert — 実際の振り分けはサーバが中身で行う
    expect(looksLikeZip({ name: 'notes.enex' })).toBe(false)
    expect(looksLikeZip({ name: 'zip' })).toBe(false)
  })
})

describe('tooLargeMessage', () => {
  test('says nothing before a file is chosen', () => {
    // Arrange & Act & Assert
    expect(tooLargeMessage(null)).toBeNull()
  })

  test('lets a ZIP right at the limit through', () => {
    // Arrange
    const file = { name: 'a.zip', size: MAX_ZIP_BYTES }

    // Act & Assert
    expect(tooLargeMessage(file)).toBeNull()
  })

  test('explains a ZIP over the ZIP limit', () => {
    // Arrange
    const file = { name: 'a.zip', size: MAX_ZIP_BYTES + 1 }

    // Act & Assert
    expect(tooLargeMessage(file)).toBe(zipTooLargeMessage(MAX_ZIP_BYTES + 1))
  })

  test('holds an ENEX to the smaller ENEX limit', () => {
    // Arrange — ZIP なら通る大きさでも、ENEX の上限で断る
    const file = { name: 'a.enex', size: MAX_ENEX_BYTES + 1 }

    // Act & Assert
    expect(tooLargeMessage(file)).toBe(enexTooLargeMessage(MAX_ENEX_BYTES + 1))
  })

  test('lets an ENEX right at the limit through', () => {
    // Arrange
    const file = { name: 'a.enex', size: MAX_ENEX_BYTES }

    // Act & Assert
    expect(tooLargeMessage(file)).toBeNull()
  })
})

describe('countRenumbered', () => {
  test('counts only the notes that got a new number', () => {
    // Arrange
    const report = {
      imported: [
        { itemNo: '20001', title: 'a', renumberedFrom: '1042' },
        { itemNo: '1043', title: 'b' },
        { itemNo: '20002', title: '', renumberedFrom: '1044' },
      ],
    }

    // Act & Assert
    expect(countRenumbered(report)).toBe(2)
  })

  test('is zero when nothing was imported', () => {
    // Arrange & Act & Assert
    expect(countRenumbered({ imported: [] })).toBe(0)
  })
})
