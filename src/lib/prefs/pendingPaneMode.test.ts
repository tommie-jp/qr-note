import { describe, expect, test } from 'vitest'
import {
  beginPaneModeSwitch,
  endPaneModeSwitch,
  IDLE_PANE_MODE,
  settlePendingPaneMode,
} from './pendingPaneMode'

describe('送った先のペイン構成', () => {
  test('押した瞬間に送った先を持ち、返事待ちを数える', () => {
    const state = beginPaneModeSwitch(IDLE_PANE_MODE, '1')

    expect(state).toEqual({ mode: '1', inflight: 1 })
  })

  test('保存が通っても、描き直しが来るまでは送った先を持ち続ける', () => {
    const saved = endPaneModeSwitch(beginPaneModeSwitch(IDLE_PANE_MODE, '1'), true)

    expect(saved).toEqual({ mode: '1', inflight: 0 })
    // サーバはまだ元の構成 (2) を描いている
    expect(settlePendingPaneMode(saved, '2')).toBe(saved)
  })

  test('描き直しが送った先に追いついたら片付ける', () => {
    const saved = endPaneModeSwitch(beginPaneModeSwitch(IDLE_PANE_MODE, '1'), true)

    expect(settlePendingPaneMode(saved, '1')).toBe(IDLE_PANE_MODE)
  })

  test('保存に失敗したら送った先を捨てる (cookie は元のまま)', () => {
    const failed = endPaneModeSwitch(beginPaneModeSwitch(IDLE_PANE_MODE, '3'), false)

    expect(failed).toEqual({ mode: null, inflight: 0 })
  })

  // 2 → 1 → 3 と続けて押すと、1 回目の保存の後の描き直しは 1 を描く。
  // そこで片付けると画面が 1 へ戻ってから 3 へ跳ねる
  test('続けて押した途中では、途中の構成に追いついても片付けない', () => {
    const twice = beginPaneModeSwitch(beginPaneModeSwitch(IDLE_PANE_MODE, '1'), '3')
    const firstSaved = endPaneModeSwitch(twice, true)

    expect(firstSaved).toEqual({ mode: '3', inflight: 1 })
    expect(settlePendingPaneMode(firstSaved, '1')).toBe(firstSaved)
    expect(settlePendingPaneMode(firstSaved, '3')).toBe(firstSaved)
  })

  test('続けて押した途中の失敗では、まだ送った先を捨てない', () => {
    const twice = beginPaneModeSwitch(beginPaneModeSwitch(IDLE_PANE_MODE, '1'), '3')

    expect(endPaneModeSwitch(twice, false)).toEqual({ mode: '3', inflight: 1 })
  })

  test('返事待ちは 0 より下がらない', () => {
    expect(endPaneModeSwitch(IDLE_PANE_MODE, true)).toEqual({ mode: null, inflight: 0 })
  })
})
