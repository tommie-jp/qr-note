// カレンダーの表示の設定の端末側の控え (docs/126 §1-12・§1-20)。
//
// 色と表示 (layout) で正本の場所が違う:
//   色 (colors・textColors) … サーバ (user_settings)。端末をまたいで同じ。
//     読みの順は 端末の写し (localStorage) → API。写しは開いた直後に既定の色が
//     1 度ちらつかないためだけに使う
//   表示 (大きさ・余白・予定数) … この端末の localStorage。サーバへは送らない
//     (iPhone と PC で別々に選べる)。前の版は色と一緒の写しに入っていたので、
//     端末の表示がまだ無ければその写しから引き継ぐ
// 変えたら即座に画面へ当て、色の保存は少し待ってまとめて送る — カラーピッカーは
// 引きずっている間ずっと値を送ってくるので、1 回ごとに PUT しない
import "client-only";
import { useSyncExternalStore } from "react";
import { apiGet, apiSend } from "@/lib/client/api";
import { applyPaneSidePadding, SIDE_PADDING_PX } from "@/lib/prefs/paneSidePadding";
import {
  DEFAULT_CALENDAR_PREFS,
  layoutOf,
  parseCalendarLayout,
  parseCalendarPrefs,
  type CalendarPrefs,
} from "../event/calendarPrefs";

// サーバの色の写し (前の版は表示も含む全体)
const STORAGE_KEY = "qr-calendar-prefs";
// この端末の表示 (正本)
const LAYOUT_KEY = "qr-calendar-layout";
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
  if (next.prefs.sidePadding !== state.prefs.sidePadding) {
    // フォルダーペインの余白も同じ値にする (docs/86 §4-20)
    applyPaneSidePadding(SIDE_PADDING_PX[next.prefs.sidePadding]);
  }
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 書けなくても今の画面には効いている (iOS のプライベート閲覧など)
  }
}

function writeCopy(prefs: CalendarPrefs): void {
  writeLocal(STORAGE_KEY, { colors: prefs.colors, textColors: prefs.textColors });
  writeLocal(LAYOUT_KEY, layoutOf(prefs));
}

// 色だけが変わったか (表示だけの変更はサーバへ送らない)
function colorsChanged(a: CalendarPrefs, b: CalendarPrefs): boolean {
  return (
    JSON.stringify([a.colors, a.textColors]) !== JSON.stringify([b.colors, b.textColors])
  );
}

// 最初に購読されたとき 1 度だけ: 写しと端末の表示を読み、サーバの色で上書きする
function start(): void {
  if (started) {
    return;
  }
  started = true;
  try {
    const copy = localStorage.getItem(STORAGE_KEY);
    const layout = localStorage.getItem(LAYOUT_KEY);
    // 端末の表示がまだ無ければ、前の版の写し (表示も含む) から引き継ぐ
    const prefs = { ...parseCalendarPrefs(copy), ...parseCalendarLayout(layout ?? copy) };
    state = { ...state, prefs };
    // 写しが無い端末 (前の版から) もここで揃える
    applyPaneSidePadding(SIDE_PADDING_PX[prefs.sidePadding]);
    if (layout === null && copy !== null) {
      writeCopy(prefs);
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
      // サーバから採るのは色だけ。表示はこの端末の値を残す
      const prefs = { ...parseCalendarPrefs(JSON.stringify(data)), ...layoutOf(state.prefs) };
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
    await apiSend("PUT", SETTINGS_PATH, { colors: prefs.colors, textColors: prefs.textColors });
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

// 設定を変える。画面へはすぐ当て、表示は端末に書き、色はサーバへ少し待ってから送る
export function updateCalendarPrefs(prefs: CalendarPrefs): void {
  const previous = state.prefs;
  writeCopy(prefs);
  emit({ ...state, prefs });
  if (!colorsChanged(previous, prefs)) {
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    void save(prefs);
  }, SAVE_DELAY_MS);
}
