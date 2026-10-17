import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const diag = vi.hoisted(() => ({ events: [] as string[] }))
vi.mock('@/lib/logging/diagLog', () => ({
  logDiagEvent: (text: string) => {
    diag.events.push(text)
  },
}))

// 偽の Audio。play の振る舞いをテストごとに差し替える
class FakeAudio {
  static created: FakeAudio[] = []
  static play: () => Promise<void> = () => Promise.resolve()
  preload = ''
  currentTime = 5
  plays = 0
  constructor(public src: string) {
    FakeAudio.created.push(this)
  }
  play(): Promise<void> {
    this.plays += 1
    return FakeAudio.play()
  }
}

beforeEach(() => {
  vi.resetModules()
  FakeAudio.created = []
  FakeAudio.play = () => Promise.resolve()
  diag.events = []
  vi.stubGlobal('Audio', FakeAudio)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const load = () => import('./scanBeepPlayer')

test('用意した音を頭から鳴らす', async () => {
  const { prepareScanBeep, playScanBeep } = await load()
  prepareScanBeep(1)
  await playScanBeep()
  const [audio] = FakeAudio.created
  expect(audio.plays).toBe(1)
  expect(audio.currentTime).toBe(0)
  expect(audio.preload).toBe('auto')
  expect(audio.src.startsWith('data:audio/wav;base64,')).toBe(true)
})

test('同じ段なら要素を作り直さない', async () => {
  const { prepareScanBeep } = await load()
  prepareScanBeep(0.25)
  prepareScanBeep(0.25)
  expect(FakeAudio.created).toHaveLength(1)
  prepareScanBeep(1)
  expect(FakeAudio.created).toHaveLength(2)
})

test('消音では鳴らさない', async () => {
  const { prepareScanBeep, playScanBeep } = await load()
  prepareScanBeep(1)
  prepareScanBeep(0)
  await playScanBeep()
  expect(FakeAudio.created[0].plays).toBe(0)
})

test('用意していなければ何もせず解決する', async () => {
  const { playScanBeep } = await load()
  await expect(playScanBeep()).resolves.toBeUndefined()
})

// 鳴り始めない端末で遷移が止まらないこと
test('鳴り始めなくても上限で解決する', async () => {
  vi.useFakeTimers()
  FakeAudio.play = () => new Promise(() => {})
  const { prepareScanBeep, playScanBeep, SCAN_BEEP_START_WAIT_MS } = await load()
  prepareScanBeep(1)
  let done = false
  const pending = playScanBeep().then(() => {
    done = true
  })
  await vi.advanceTimersByTimeAsync(SCAN_BEEP_START_WAIT_MS - 1)
  expect(done).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  await pending
  expect(done).toBe(true)
})

test('再生を断られても投げず、理由を診断ログに残す', async () => {
  FakeAudio.play = () => Promise.reject(new Error('NotAllowedError'))
  const { prepareScanBeep, playScanBeep } = await load()
  prepareScanBeep(1)
  await expect(playScanBeep()).resolves.toBeUndefined()
  expect(diag.events.some((e) => e.includes('[スキャン音]') && e.includes('NotAllowedError'))).toBe(true)
})
