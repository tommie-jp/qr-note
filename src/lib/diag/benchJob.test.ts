import { afterEach, expect, test, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { jobProgress, startJob } = await import('./benchJob')

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.restoreAllMocks()
})

test('走っている間は 2 本目を始めない (種類が違っても)', async () => {
  // Arrange
  let release = () => {}
  const first = new Promise<void>((resolve) => {
    release = resolve
  })

  // Act
  const started = startJob('cpu', () => first)
  const second = startJob('server', async () => {})

  // Assert
  expect(started).toBe(true)
  expect(second).toBe(false)
  expect(jobProgress().running).toBe('cpu')
  release()
  await flush()
  expect(jobProgress().running).toBeNull()
})

test('失敗は種類ごとに理由を残し、次の計測を始められる', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})

  startJob('server', async () => {
    throw new Error('sharp is missing')
  })
  await flush()

  expect(jobProgress().running).toBeNull()
  expect(jobProgress().errors.server).toContain('sharp is missing')
  expect(startJob('server', async () => {})).toBe(true)
  await flush()
  expect(jobProgress().errors.server).toBeUndefined()
})
