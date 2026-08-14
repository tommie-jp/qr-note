import { describe, expect, test } from 'vitest'
import { extractHealthSources } from './healthFences'

describe('extractHealthSources', () => {
  test('```health の中身を取り出す', () => {
    expect(extractHealthSources('```health\n#健康管理\ny=体重\n```')).toEqual([
      '#健康管理\ny=体重',
    ])
  })

  test('同じ中身のフェンスは 1 つに畳む (集計を共有する)', () => {
    const markdown = [
      '```health',
      '#健康管理',
      '```',
      '',
      '```health',
      '#健康管理',
      '```',
    ].join('\n')
    expect(extractHealthSources(markdown)).toEqual(['#健康管理'])
  })

  test('中身が空でも取り出す (絞り込みなしのグラフ)', () => {
    expect(extractHealthSources('```health\n```')).toEqual([''])
  })

  test('他の言語のフェンスは拾わない', () => {
    const markdown = ['```matrix', '#電験三種', '```', '```text', 'health', '```'].join(
      '\n',
    )
    expect(extractHealthSources(markdown)).toEqual([])
  })

  test('入れ子のフェンスの中は拾わない (記法の説明を書いたノート)', () => {
    const markdown = ['````markdown', '```health', '#健康管理', '```', '````'].join(
      '\n',
    )
    expect(extractHealthSources(markdown)).toEqual([])
  })
})
