// 回路図の SVG を引く URL (docs/124 §1)。サーバと端末の両方から読む葉
export const CIRCUIT_SVG_PATH = '/api/circuits/svg'

export function circuitSvgUrl(hash: string): string {
  return `${CIRCUIT_SVG_PATH}/${encodeURIComponent(hash)}`
}
