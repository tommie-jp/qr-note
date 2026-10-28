import { describe, expect, test } from 'vitest'
import {
  IDLE_VIEW_SWITCH,
  beginViewSwitch,
  endViewSwitch,
  settleViewSwitch,
  shownViewMode,
} from './pendingViewMode'

describe('表示モードの切替 (押した瞬間に見せる。docs/118 §10 案 B)', () => {
  test('押すと送った先をその場で見せる', () => {
    const state = beginViewSwitch(IDLE_VIEW_SWITCH, 'card')

    expect(shownViewMode(state, 'compact')).toBe('card')
  })

  test('保存が通っても、サーバの描き直しが届くまで送った先を見せ続ける', () => {
    const saved = endViewSwitch(beginViewSwitch(IDLE_VIEW_SWITCH, 'card'), true)

    expect(shownViewMode(saved, 'compact')).toBe('card')
  })

  test('描き直しが送った先に追いついたら片付ける', () => {
    const saved = endViewSwitch(beginViewSwitch(IDLE_VIEW_SWITCH, 'card'), true)

    expect(settleViewSwitch(saved, 'card')).toBe(IDLE_VIEW_SWITCH)
  })

  test('保存が失敗して待ちが無くなったら、元のモード (サーバの値) へ戻す', () => {
    const failed = endViewSwitch(beginViewSwitch(IDLE_VIEW_SWITCH, 'card'), false)

    expect(shownViewMode(failed, 'compact')).toBe('compact')
  })

  test('続けて押したとき、途中の描き直し (1 回目の結果) では片付けない', () => {
    const twice = beginViewSwitch(beginViewSwitch(IDLE_VIEW_SWITCH, 'medium'), 'card')
    const firstSaved = endViewSwitch(twice, true)

    const afterFirstRender = settleViewSwitch(firstSaved, 'medium')

    expect(shownViewMode(afterFirstRender, 'medium')).toBe('card')
  })

  test('続けて押した途中で 1 本失敗しても、残りの返事待ちがあれば送った先を持つ', () => {
    const twice = beginViewSwitch(beginViewSwitch(IDLE_VIEW_SWITCH, 'medium'), 'card')

    expect(shownViewMode(endViewSwitch(twice, false), 'compact')).toBe('card')
  })

  test('何も押していなければサーバの値を見せる', () => {
    expect(shownViewMode(IDLE_VIEW_SWITCH, 'image')).toBe('image')
  })
})
