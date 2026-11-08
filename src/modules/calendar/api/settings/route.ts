// GET / PUT /api/calendar/settings (docs/126 §1-12)。カレンダーの表示の設定
// (日付の文字の大きさ・優先度ごとの色) を利用者ごとに読み書きする。
// src/app/api/calendar/settings/route.ts はこれを再輸出するだけ (モジュールの境界)。
//
// 保存は user_settings の 1 行 (prefs/userSettingStore.ts)。名前はセッションから取り、
// 本文で名乗らせない。デモは共有アカウントなので保存を断る (選択行の色と同じ)
import 'server-only'
import type { NextResponse } from 'next/server'
import { readUserSetting, writeUserSetting } from '@/lib/prefs/userSettingStore'
import { guardRequest } from '@/lib/route/guard'
import { parseJsonBody } from '@/lib/route/parse'
import { apiOk } from '@/lib/route/respond'
import { CALENDAR_PREFS_SETTING_KEY, parseCalendarPrefs, validateCalendarPrefs } from '../../event/calendarPrefs'

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'allow' })
  if (!guard.ok) {
    return guard.response
  }
  return apiOk(parseCalendarPrefs(await readUserSetting(guard.user, CALENDAR_PREFS_SETTING_KEY)))
}

export async function PUT(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }
  // 知らない値は畳まず断る (validateCalendarPrefs)
  const prefs = await parseJsonBody(request, validateCalendarPrefs)
  if (!prefs.ok) {
    return prefs.response
  }
  await writeUserSetting(guard.user, CALENDAR_PREFS_SETTING_KEY, JSON.stringify(prefs.value))
  return apiOk(prefs.value)
}
