// ノート 1 件を API で運ぶ形 (docs/123 §1-2)。
//
// **Prisma の Item をそのまま JSON にした形**にする。画面の部品 (ItemList・
// ItemTimestamps・TrashList …) は Item 型で書かれていて、端末側で
// reviveItem() を通せば同じ Item に戻る。別の形を作ると部品を全部書き換える
// ことになり、サーバ描画の公開ビューと端末描画の画面で型が割れる。
//
// サーバとクライアントの両方から読むので、server-only も client-only も付けない。
// Item は型としてだけ読む (prisma の実体を束に入れない)

import type { Item } from '@/generated/prisma/client'

export interface ItemDto {
  itemId: string
  memo: string
  title: string
  tags: string[]
  props: unknown
  taskTodo: number
  taskDone: number
  createdAt: string
  updatedAt: string
  accessedAt: string
  deletedAt: string | null
  publicAt: string | null
  offlinePin: boolean
}

export function toItemDto(item: Item): ItemDto {
  return {
    itemId: item.itemId,
    memo: item.memo,
    title: item.title,
    tags: item.tags,
    props: item.props,
    taskTodo: item.taskTodo,
    taskDone: item.taskDone,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    accessedAt: item.accessedAt.toISOString(),
    deletedAt: item.deletedAt?.toISOString() ?? null,
    publicAt: item.publicAt?.toISOString() ?? null,
    offlinePin: item.offlinePin,
  }
}

export function reviveItem(dto: ItemDto): Item {
  return {
    ...dto,
    props: dto.props as Item['props'],
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
    accessedAt: new Date(dto.accessedAt),
    deletedAt: dto.deletedAt === null ? null : new Date(dto.deletedAt),
    publicAt: dto.publicAt === null ? null : new Date(dto.publicAt),
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isIsoDate(value: unknown): value is string {
  return isString(value) && !Number.isNaN(Date.parse(value))
}

function isNullableIsoDate(value: unknown): value is string | null {
  return value === null || isIsoDate(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

// 外から来た値 (API の応答) を信用しない。形が違えば false
export function isItemDto(value: unknown): value is ItemDto {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return (
    isString(v.itemId) &&
    v.itemId !== '' &&
    isString(v.memo) &&
    isString(v.title) &&
    Array.isArray(v.tags) &&
    v.tags.every(isString) &&
    isCount(v.taskTodo) &&
    isCount(v.taskDone) &&
    isIsoDate(v.createdAt) &&
    isIsoDate(v.updatedAt) &&
    isIsoDate(v.accessedAt) &&
    isNullableIsoDate(v.deletedAt) &&
    isNullableIsoDate(v.publicAt) &&
    typeof v.offlinePin === 'boolean'
  )
}
