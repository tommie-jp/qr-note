import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { POST } from './route'

// CSP 違反の報告先 (lib/security/csp.ts)。門番は無く、本文の上限と件数で守る
function report(body: string, size?: number): Request {
  return new Request('http://localhost/api/csp-report', {
    method: 'POST',
    headers: { 'content-type': 'application/csp-report' },
    body: size === undefined ? body : 'x'.repeat(size),
  })
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
})

describe('POST /api/csp-report', () => {
  test('logs one warning per report and answers 204', async () => {
    const response = await POST(
      report(
        JSON.stringify({
          'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': 'eval' },
        }),
      ),
    )

    expect(response.status).toBe(204)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('CSP 違反: script-src が eval を止めた')
  })

  test('drops bodies over the limit with 413 instead of reading them', async () => {
    const response = await POST(report('', 20 * 1024))

    expect(response.status).toBe(413)
    expect(warn).not.toHaveBeenCalled()
  })

  test('stays quiet on unparsable bodies', async () => {
    const response = await POST(report('{{{'))

    expect(response.status).toBe(204)
    expect(warn).not.toHaveBeenCalled()
  })
})
