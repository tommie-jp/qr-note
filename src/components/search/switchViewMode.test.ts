import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { IDLE_VIEW_SWITCH, pendingViewModeStore } from '@/lib/prefs/pendingViewMode'
import { VIEW_MODE_ENDPOINT, switchViewMode } from './switchViewMode'

// 表示モードの切替の流れ (docs/118 §10 案 B)。switchPaneMode のテストの写し
const fetchMock = vi.fn()

beforeEach(() => {
  pendingViewModeStore.set(IDLE_VIEW_SWITCH)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('押した瞬間に送った先を見せ、保存してから描き直す', async () => {
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
  const refresh = vi.fn()

  const done = switchViewMode('card', refresh)

  // 返事を待たずに送った先が見える
  expect(pendingViewModeStore.get().mode).toBe('card')
  expect(refresh).not.toHaveBeenCalled()
  await done
  expect(fetchMock).toHaveBeenCalledWith(
    VIEW_MODE_ENDPOINT,
    expect.objectContaining({ method: 'PUT', body: JSON.stringify({ mode: 'card' }) }),
  )
  expect(refresh).toHaveBeenCalledTimes(1)
  // 描き直しが追いつくまでは送った先を持ち続ける
  expect(pendingViewModeStore.get()).toEqual({ mode: 'card', inflight: 0 })
})

test('続けて押すと順に保存し、描き直しは最後の 1 回だけ', async () => {
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
  const refresh = vi.fn()

  void switchViewMode('card', refresh)
  const done = switchViewMode('image', refresh)
  await done

  const sent = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).mode)
  expect(sent).toEqual(['card', 'image'])
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(pendingViewModeStore.get().mode).toBe('image')
})

test('保存に失敗したら送った先を捨て、知らせを残す', async () => {
  fetchMock.mockResolvedValue(new Response('{}', { status: 401 }))
  const refresh = vi.fn()

  await switchViewMode('image', refresh)

  expect(pendingViewModeStore.get()).toEqual(IDLE_VIEW_SWITCH)
  expect(console.error).toHaveBeenCalled()
  expect(refresh).toHaveBeenCalledTimes(1)
})

test('通信が落ちても投げずに送った先を捨てる', async () => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

  await switchViewMode('image', () => {})

  expect(pendingViewModeStore.get()).toEqual(IDLE_VIEW_SWITCH)
})
