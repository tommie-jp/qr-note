import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { IDLE_PANE_MODE, pendingPaneModeStore } from '@/lib/prefs/pendingPaneMode'
import { PANE_MODE_ENDPOINT, switchPaneMode } from './switchPaneMode'

const fetchMock = vi.fn()

beforeEach(() => {
  pendingPaneModeStore.set(IDLE_PANE_MODE)
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

  const done = switchPaneMode('1', refresh)

  // 返事を待たずに送った先が見える
  expect(pendingPaneModeStore.get().mode).toBe('1')
  expect(refresh).not.toHaveBeenCalled()
  await done
  expect(fetchMock).toHaveBeenCalledWith(
    PANE_MODE_ENDPOINT,
    expect.objectContaining({ method: 'PUT', body: JSON.stringify({ mode: '1' }) }),
  )
  expect(refresh).toHaveBeenCalledTimes(1)
  // 描き直しが追いつくまでは送った先を持ち続ける
  expect(pendingPaneModeStore.get()).toEqual({ mode: '1', inflight: 0 })
})

test('続けて押すと順に保存し、描き直しは最後の 1 回だけ', async () => {
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
  const refresh = vi.fn()

  void switchPaneMode('1', refresh)
  const done = switchPaneMode('3', refresh)
  await done

  const sent = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).mode)
  expect(sent).toEqual(['1', '3'])
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(pendingPaneModeStore.get().mode).toBe('3')
})

test('保存に失敗したら送った先を捨て、知らせを残す', async () => {
  fetchMock.mockResolvedValue(new Response('{}', { status: 401 }))
  const refresh = vi.fn()

  await switchPaneMode('3', refresh)

  expect(pendingPaneModeStore.get()).toEqual(IDLE_PANE_MODE)
  expect(console.error).toHaveBeenCalled()
  expect(refresh).toHaveBeenCalledTimes(1)
})

test('通信が落ちても投げずに送った先を捨てる', async () => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

  await switchPaneMode('3', () => {})

  expect(pendingPaneModeStore.get()).toEqual(IDLE_PANE_MODE)
})
