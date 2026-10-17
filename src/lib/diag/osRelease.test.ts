import { expect, test } from 'vitest'
import { osPrettyName, parseOsRelease } from './osRelease'

const UBUNTU = `PRETTY_NAME="Ubuntu 24.04.2 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
VERSION="24.04.2 LTS (Noble Numbat)"
ID=ubuntu
ID_LIKE=debian
HOME_URL="https://www.ubuntu.com/"
`

test('KEY=VALUE を読み、二重引用符は外す', () => {
  // Act
  const fields = parseOsRelease(UBUNTU)

  // Assert
  expect(fields.PRETTY_NAME).toBe('Ubuntu 24.04.2 LTS')
  expect(fields.ID).toBe('ubuntu')
  expect(fields.VERSION_ID).toBe('24.04')
})

test('空行・コメント・= の無い行は読み飛ばす', () => {
  // Arrange
  const text = '# comment\n\nBROKEN\nNAME=Debian\n'

  // Act
  const fields = parseOsRelease(text)

  // Assert
  expect(fields).toEqual({ NAME: 'Debian' })
})

test('値に = を含む行は最初の = で切る', () => {
  expect(parseOsRelease('BUG_REPORT_URL=https://x/?a=b')).toEqual({
    BUG_REPORT_URL: 'https://x/?a=b',
  })
})

test('表示名は PRETTY_NAME を使い、無ければ NAME と VERSION_ID をつなぐ', () => {
  expect(osPrettyName(UBUNTU)).toBe('Ubuntu 24.04.2 LTS')
  expect(osPrettyName('NAME="Debian GNU/Linux"\nVERSION_ID="12"\n')).toBe(
    'Debian GNU/Linux 12',
  )
  expect(osPrettyName('ID=alpine\n')).toBe('alpine')
})

test('何も読めなければ null', () => {
  expect(osPrettyName('')).toBeNull()
  expect(osPrettyName('# only comments\n')).toBeNull()
})
