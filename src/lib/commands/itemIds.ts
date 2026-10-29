// JSON で受け取ったノートの id の並びを検める (itemSelection.ts の
// parseSelectedItemIds と同じ規則: 形の悪い id は落とし、重複も落とし、上限で切る)
import { isValidItemId } from '@/lib/validation'

const MAX_BULK_ITEMS = 5000

export function parseItemIdList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const seen = new Set<string>()
  const itemIds: string[] = []
  for (const id of value) {
    if (typeof id !== 'string' || !isValidItemId(id) || seen.has(id)) {
      continue
    }
    seen.add(id)
    itemIds.push(id)
    if (itemIds.length >= MAX_BULK_ITEMS) {
      break
    }
  }
  return itemIds
}
