// 写真の撮影情報を残すかの読み書き (docs/97-写真の撮影情報削除計画.md §5)。
// 値の意味と既定は prefs/photoMeta.ts が持つ。
//
// **サーバ専用。** prisma を掴むので、クライアント部品から import しないこと。

import 'server-only'
import { isDemoMode } from '@/lib/appEnv'
import {
  DEFAULT_PHOTO_META_MODE,
  parsePhotoMetaMode,
  PHOTO_META_SETTING_KEY,
  type PhotoMetaMode,
} from './photoMeta'
import { readUserSetting, writeUserSetting } from './userSettingStore'

// 写真を保存する口 (api/images・api/import) と layout がこれを読む。
//
// 未ログインとデモは DB を引かずに「消す」。デモは共有アカウントなので、
// 誰かが「残す」にすると全員の写真に効いてしまう (§2-5)。呼ぶ側に
// デモの分岐を持たせず、ここで畳む
export async function loadPhotoMetaMode(userName: string | null): Promise<PhotoMetaMode> {
  if (userName === null || isDemoMode()) {
    return DEFAULT_PHOTO_META_MODE
  }
  return parsePhotoMetaMode(await readUserSetting(userName, PHOTO_META_SETTING_KEY))
}

export async function savePhotoMetaMode(userName: string, mode: PhotoMetaMode): Promise<void> {
  await writeUserSetting(userName, PHOTO_META_SETTING_KEY, mode)
}
