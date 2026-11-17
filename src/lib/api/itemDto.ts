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
  // 予定の派生列 (docs/126 §1-2)。省略可にしているのは、この列を知らない
  // 版のサーバ・控えの応答も受けるため (読めなければ null に倒す)
  eventStart?: string | null
  eventEnd?: string | null
  eventRepeat?: string | null
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
    eventStart: item.eventStart?.toISOString() ?? null,
    eventEnd: item.eventEnd?.toISOString() ?? null,
    eventRepeat: item.eventRepeat,
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
    eventStart: dto.eventStart ? new Date(dto.eventStart) : null,
    eventEnd: dto.eventEnd ? new Date(dto.eventEnd) : null,
    eventRepeat: dto.eventRepeat ?? null,
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

// 予定の派生列は知らない版の応答では無い (undefined) ので、無いのも認める
function optional(check: (value: unknown) => boolean): (value: unknown) => boolean {
  return (value) => value === undefined || check(value)
}

// 項目ごとの形の確かめ。props は中身を問わない (JSON なら何でもよい)
const FIELD_CHECKS: Partial<Record<keyof ItemDto, (value: unknown) => boolean>> = {
  itemId: (value) => isString(value) && value !== '',
  memo: isString,
  title: isString,
  tags: (value) => Array.isArray(value) && value.every(isString),
  taskTodo: isCount,
  taskDone: isCount,
  createdAt: isIsoDate,
  updatedAt: isIsoDate,
  accessedAt: isIsoDate,
  deletedAt: isNullableIsoDate,
  publicAt: isNullableIsoDate,
  offlinePin: (value) => typeof value === 'boolean',
  eventStart: optional(isNullableIsoDate),
  eventEnd: optional(isNullableIsoDate),
  eventRepeat: optional((value) => value === null || isString(value)),
}

// 外から来た値 (API の応答) を信用しない。形が違えば false
export function isItemDto(value: unknown): value is ItemDto {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return Object.entries(FIELD_CHECKS).every(([key, check]) => check(v[key]))
}
