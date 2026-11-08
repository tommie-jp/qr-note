// カレンダーの表示の設定の端末側の控え (docs/126 §1-12)。
//
// 読みの順は 端末の写し (localStorage) → API。写しは開いた直後に既定の色が
// 1 度ちらつかないためだけに使い、正本はサーバ (user_settings) が持つ。
// 変えたら即座に画面へ当て、保存は少し待ってまとめて送る — カラーピッカーは
// 引きずっている間ずっと値を送ってくるので、1 回ごとに PUT しない
import "client-only";
import { useSyncExternalStore } from "react";
import { apiGet, apiSend } from "@/lib/client/api";
import { DEFAULT_CALENDAR_PREFS, parseCalendarPrefs, type CalendarPrefs } from "../event/calendarPrefs";

const STORAGE_KEY = "qr-calendar-prefs";
const SETTINGS_PATH = "/api/calendar/settings";
// 最後に変えてから保存するまでの間 (ms)
const SAVE_DELAY_MS = 600;

export interface PrefsState {
  prefs: CalendarPrefs;
  // 保存に失敗したときの知らせ (次に保存できたら消える)
  error: string | null;
}

let state: PrefsState = { prefs: DEFAULT_CALENDAR_PREFS, error: null };
let started = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function emit(next: PrefsState): void {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

function writeCopy(prefs: CalendarPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // 写しは無くても困らない (iOS のプライベート閲覧など)
  }
}

// 最初に購読されたとき 1 度だけ: 写しを読み、サーバの値で上書きする
function start(): void {
  if (started) {
    return;
  }
  started = true;
  try {
    const copy = localStorage.getItem(STORAGE_KEY);
    if (copy !== null) {
      state = { ...state, prefs: parseCalendarPrefs(copy) };
    }
  } catch {
    // 読めなければ既定のまま
  }
  apiGet<unknown>(SETTINGS_PATH)
    .then(({ data }) => {
      // 取りに行っている間に利用者が変えていたら、そちらを残す
      if (saveTimer !== undefined) {
        return;
      }
      const prefs = parseCalendarPrefs(JSON.stringify(data));
      writeCopy(prefs);
      emit({ ...state, prefs });
    })
    .catch(() => {
      // 読めなければ写し (か既定) のまま描く。表示の設定なので知らせない
    });
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCalendarPrefs(): PrefsState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

async function save(prefs: CalendarPrefs): Promise<void> {
  try {
    await apiSend("PUT", SETTINGS_PATH, prefs);
    if (state.error !== null) {
      emit({ ...state, error: null });
    }
  } catch (error) {
    emit({
      ...state,
      error: `設定を保存できませんでした (この端末では効いています): ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

// 設定を変える。画面へはすぐ当て、サーバへは少し待ってから送る
export function updateCalendarPrefs(prefs: CalendarPrefs): void {
  writeCopy(prefs);
  emit({ ...state, prefs });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    void save(prefs);
  }, SAVE_DELAY_MS);
}
