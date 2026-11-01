import { describe, expect, test } from 'vitest'
import { summarizeCspReports } from './cspReport'

describe('summarizeCspReports', () => {
  test('reads the legacy report-uri shape', () => {
    const text = JSON.stringify({
      'csp-report': {
        'document-uri': 'https://qr.example.jp/item/1',
        'effective-directive': 'script-src',
        'blocked-uri': 'inline',
        'source-file': 'https://qr.example.jp/x.js',
        'line-number': 12,
      },
    })
    expect(summarizeCspReports(text)).toEqual([
      'script-src が inline を止めた (頁 https://qr.example.jp/item/1, 出所 https://qr.example.jp/x.js:12)',
    ])
  })

  test('reads the report-to shape and caps the count', () => {
    const reports = Array.from({ length: 8 }, (_, i) => ({
      type: 'csp-violation',
      body: {
        documentURL: 'https://qr.example.jp/',
        effectiveDirective: 'img-src',
        blockedURL: `https://evil.example/${i}.png`,
      },
    }))
    const lines = summarizeCspReports(JSON.stringify(reports))
    expect(lines).toHaveLength(5)
    expect(lines[0]).toContain('img-src が https://evil.example/0.png を止めた')
  })

  test('ignores other report types and garbage', () => {
    expect(summarizeCspReports('not json')).toEqual([])
    expect(summarizeCspReports(JSON.stringify([{ type: 'deprecation', body: {} }]))).toEqual([])
    expect(summarizeCspReports(JSON.stringify({ hello: 1 }))).toEqual([])
  })

  test('truncates long fields (the sender is untrusted)', () => {
    const long = 'a'.repeat(1000)
    const [line] = summarizeCspReports(
      JSON.stringify({ 'csp-report': { 'blocked-uri': long, 'violated-directive': 'x' } }),
    )
    expect(line.length).toBeLessThan(400)
    expect(line).toContain('…')
  })
})
