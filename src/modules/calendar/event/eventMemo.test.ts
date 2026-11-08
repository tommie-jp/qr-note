import { describe, expect, test } from 'vitest'
import { applyEvent, eventTitleOf, newEventMemo, requiredTags, setEventDone } from './eventMemo'

const timed = { title: '歯医者', date: '2026-11-05', start: '10:00', end: '11:00' }
const allDay = { title: '歯医者', date: '2026-11-05', start: null, end: null }

describe('newEventMemo', () => {
  test('検索式のタグを付ける', () => {
    expect(newEventMemo(timed, '#予定 #仕事')).toBe(
      '# 歯医者\n\n#予定 #仕事\ndate=2026-11-05 start=10:00 end=11:00\n',
    )
  })

  test('タグの無い検索式なら #予定', () => {
    expect(newEventMemo(allDay, '')).toBe('# 歯医者\n\n#予定\ndate=2026-11-05\n')
  })

  test('題名の改行は空白に畳む', () => {
    expect(newEventMemo({ ...allDay, title: ' 歯\n医者 ' }, '')).toMatch(/^# 歯 医者\n/)
  })
})

describe('requiredTags', () => {
  test('AND の肯定のタグだけ', () => {
    expect(requiredTags('#予定 #仕事 会議')).toEqual(['予定', '仕事'])
    expect(requiredTags('#予定 OR #仕事')).toEqual([])
    expect(requiredTags('#予定 -#仕事')).toEqual(['予定'])
  })
})

describe('applyEvent', () => {
  test('題名と時刻のトークンだけ差し替え、他は残す', () => {
    const memo = '# 歯科\n\n#予定 #通院\ndate=2026-11-04 start=09:00 room=3\n\n受付で保険証\n![](a.jpg)\n'
    expect(applyEvent(memo, timed)).toBe(
      '# 歯医者\n\n#予定 #通院\ndate=2026-11-05 start=10:00 end=11:00 room=3\n\n受付で保険証\n![](a.jpg)\n',
    )
  })

  test('終日にすると start と end を抜く', () => {
    expect(applyEvent('# 歯医者\ndate=2026-11-05 start=10:00 end=11:00\n', allDay)).toBe(
      '# 歯医者\ndate=2026-11-05\n',
    )
  })

  test('until は触らない', () => {
    expect(applyEvent('# 旅行\ndate=2026-11-05 until=2026-11-07\n', { ...allDay, title: '旅行' })).toBe(
      '# 旅行\ndate=2026-11-05 until=2026-11-07\n',
    )
  })

  test('見出しが無ければ先頭に挿す', () => {
    expect(applyEvent('歯医者のメモ\ndate=2026-11-05\n', allDay)).toBe('# 歯医者\n\n歯医者のメモ\ndate=2026-11-05\n')
  })

  test('date= の行が無ければ末尾に足す', () => {
    expect(applyEvent('# 歯医者\n\n本文\n\n', timed)).toBe(
      '# 歯医者\n\n本文\ndate=2026-11-05 start=10:00 end=11:00\n',
    )
  })

  test('他のプロパティ行は触らず、date= の行を探す', () => {
    expect(applyEvent('# 歯医者\nhFE=208\ndate=2026-11-01\n', allDay)).toBe('# 歯医者\nhFE=208\ndate=2026-11-05\n')
  })

  test('コードフェンスの中の date= は触らない', () => {
    const memo = '# 歯医者\n```\ndate=2000-01-01\n```\n'
    expect(applyEvent(memo, allDay)).toBe('# 歯医者\n```\ndate=2000-01-01\n```\ndate=2026-11-05\n')
  })

  test('CRLF の本文は CRLF のまま', () => {
    expect(applyEvent('# a\r\ndate=2026-11-01\r\n', allDay)).toBe('# 歯医者\r\ndate=2026-11-05\r\n')
  })

  test('#タグ の行は見出しと見なさない', () => {
    expect(applyEvent('#予定\ndate=2026-11-01\n', allDay)).toBe('# 歯医者\n\n#予定\ndate=2026-11-05\n')
  })
})

describe('eventTitleOf', () => {
  test('先頭の見出しを読む', () => {
    expect(eventTitleOf('\n# 歯医者 \n本文')).toBe('歯医者')
    expect(eventTitleOf('#予定\n')).toBe('')
    expect(eventTitleOf('')).toBe('')
  })
})

describe('setEventDone', () => {
  test('予定の行の末尾に done= を足す。他の行・トークンは触らない', () => {
    const memo = '# 歯医者\n\n#予定\ndate=2026-11-05 start=10:00 place=駅前\n\n本文\n'
    expect(setEventDone(memo, '2026-11-08')).toBe(
      '# 歯医者\n\n#予定\ndate=2026-11-05 start=10:00 place=駅前 done=2026-11-08\n\n本文\n',
    )
  })

  test('済みを外すと done= だけを抜く', () => {
    const memo = '# 歯医者\ndate=2026-11-05 done=2026-11-08 start=10:00\n'
    expect(setEventDone(memo, null)).toBe('# 歯医者\ndate=2026-11-05 start=10:00\n')
  })

  test('既に済みなら日付を差し替える (2 つにしない)', () => {
    const memo = 'date=2026-11-05 done=2026-11-06\n'
    expect(setEventDone(memo, '2026-11-08')).toBe('date=2026-11-05 done=2026-11-08\n')
  })

  test('フェンスの中の date= は予定の行と見なさない。CRLF を保つ', () => {
    const memo = '```\r\ndate=2000-01-01\r\n```\r\ndate=2026-11-05\r\n'
    expect(setEventDone(memo, '2026-11-08')).toBe('```\r\ndate=2000-01-01\r\n```\r\ndate=2026-11-05 done=2026-11-08\r\n')
  })

  test('予定の行が無ければ本文をそのまま返す', () => {
    expect(setEventDone('# メモ\n', '2026-11-08')).toBe('# メモ\n')
  })

  test('applyEvent は done= を残す', () => {
    const memo = '# 歯医者\ndate=2026-11-05 done=2026-11-08\n'
    expect(applyEvent(memo, { title: '歯医者', date: '2026-11-06', start: null, end: null })).toBe(
      '# 歯医者\ndate=2026-11-06 done=2026-11-08\n',
    )
  })
})

describe('優先度 (priority=)', () => {
  test('高い・低いは予定の行に priority= を書く', () => {
    expect(applyEvent('# 歯医者\ndate=2026-11-05\n', { ...allDay, priority: 'high' })).toBe(
      '# 歯医者\ndate=2026-11-05 priority=high\n',
    )
    expect(newEventMemo({ ...timed, priority: 'low' }, '')).toBe(
      '# 歯医者\n\n#予定\ndate=2026-11-05 start=10:00 end=11:00 priority=low\n',
    )
  })

  test('標準にすると priority= を抜く (書かないのが標準)', () => {
    expect(applyEvent('# 歯医者\ndate=2026-11-05 priority=high done=2026-11-08\n', { ...allDay, priority: 'normal' })).toBe(
      '# 歯医者\ndate=2026-11-05 done=2026-11-08\n',
    )
    expect(newEventMemo({ ...allDay, priority: 'normal' }, '')).toBe('# 歯医者\n\n#予定\ndate=2026-11-05\n')
  })

  test('既にあれば位置ごと差し替える。優先度を渡さなければ触らない', () => {
    expect(applyEvent('# 歯医者\ndate=2026-11-05 priority=low place=駅前\n', { ...allDay, priority: 'high' })).toBe(
      '# 歯医者\ndate=2026-11-05 priority=high place=駅前\n',
    )
    expect(applyEvent('# 歯医者\ndate=2026-11-05 priority=low\n', allDay)).toBe('# 歯医者\ndate=2026-11-05 priority=low\n')
  })
})
