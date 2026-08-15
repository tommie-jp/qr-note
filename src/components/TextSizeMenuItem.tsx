"use client";

import { useState } from "react";
import { TextSizeIcon } from "@/components/MenuIcons";
import { HEADER_MENU_ROW_CLASS } from "@/components/ui";
import {
  DEFAULT_NOTE_FONT_SCALE,
  NOTE_FONT_SCALE_KEY,
  NOTE_FONT_SCALE_VAR,
  noteFontScaleLabel,
  normalizeNoteFontScale,
  stepNoteFontScale,
} from "@/lib/noteFontScale";

// ハンバーガーメニューの「テキストサイズ」(docs/61-テキストサイズ計画.md)。
//
// 本文の文字を ＋ / − で 1 段ずつ大きくする。効く先は本文だけで、この行を
// 含むメニュー自体は大きくならない (noteFontScale.ts の冒頭に理由)。
//
// 保存は localStorage。サーバは倍率を知らないので、この部品だけで完結する。
// 読み込み時の反映は layout.tsx の <head> に置いたインラインスクリプトが
// 先回りして済ませており、ここはその続きから始める
// (useState の遅延初期化で同じ値を読むので、両者は必ず一致する)。
//
// size-9 … 行の高さ (HEADER_MENU_ROW_CLASS の min-h-9) と揃える。ここだけ
// 44px を残すと、メニューの中でこの行だけ背が高くなり間隔がガタつく
const STEP_BUTTON_CLASS =
  "inline-flex size-9 items-center justify-center rounded text-xl text-gray-700 transition-colors hover:bg-gray-100 active:bg-gray-200 disabled:text-gray-300 disabled:hover:bg-transparent";

function readStoredScale(): number {
  try {
    return normalizeNoteFontScale(localStorage.getItem(NOTE_FONT_SCALE_KEY));
  } catch {
    // localStorage を塞いでいるブラウザ (iOS のプライベート閲覧など)。
    // 覚えられないだけで、そのセッション中の ＋ / − は効く
    return DEFAULT_NOTE_FONT_SCALE;
  }
}

export function TextSizeMenuItem() {
  const [scale, setScale] = useState(() =>
    typeof window === "undefined" ? DEFAULT_NOTE_FONT_SCALE : readStoredScale(),
  );

  const apply = (next: number) => {
    setScale(next);
    // 等倍なら変数ごと外す。CSS 側の既定 (var の第 2 引数) と同じ値を
    // わざわざ html に書き残さない
    if (next === DEFAULT_NOTE_FONT_SCALE) {
      document.documentElement.style.removeProperty(NOTE_FONT_SCALE_VAR);
    } else {
      document.documentElement.style.setProperty(
        NOTE_FONT_SCALE_VAR,
        String(next),
      );
    }
    try {
      localStorage.setItem(NOTE_FONT_SCALE_KEY, String(next));
    } catch {
      // 覚えられなくても表示は変えられたので、ここでは何も出さない。
      // 塞いでいるのは利用者の設定で、直せるのはこちらではない
    }
  };

  const canShrink = stepNoteFontScale(scale, -1) !== scale;
  const canGrow = stepNoteFontScale(scale, 1) !== scale;

  return (
    // **クリックをここで止める。** メニューのシートは「項目を押したら閉じる」
    // を親のバブリング 1 か所で受けているので (HeaderMenu.tsx)、素通しすると
    // ＋ を 1 回押しただけで閉じてしまい、続けて押せない。HeaderQrButton と
    // 同じ「自前の状態を持つ項目」の扱い。
    // 開いたままなら、暗くした覆いの向こうに本文の変化も見える
    // flex-wrap … 倍率を上げると自分の行 (名前 + ＋ / −) も大きくなり、
    // 200% では 1 行に収まらない。折り返してシートの中で 2 行になるほうが、
    // 名前が切れたり ＋ が画面の外へ出るより扱いやすい
    <div
      className={`${HEADER_MENU_ROW_CLASS} flex-wrap justify-between`}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="flex items-center gap-2">
        <TextSizeIcon />
        テキストサイズ
      </span>
      {/* -mr-3 … ボタンの的を行の px-3 の外へはみ出させて、
          右端の余白を他の行と揃える (ヘッダーの開閉ボタンと同じ手) */}
      <span className="-mr-3 flex shrink-0 items-center">
        <button
          type="button"
          aria-label="小さく"
          disabled={!canShrink}
          onClick={() => apply(stepNoteFontScale(scale, -1))}
          className={STEP_BUTTON_CLASS}
        >
          −
        </button>
        {/* 現在の倍率。押すと等倍に戻る — 何段上げたか数えなくても
            戻れるようにする。tabular-nums で桁が変わっても幅が動かない。
            aria-label に倍率も入れる … 「等倍に戻す」だけにすると読み上げの
            名前が置き換わり、画面に出ている今の倍率が読み上げからだけ消える */}
        <button
          type="button"
          aria-label={`${noteFontScaleLabel(scale)}。押すと等倍に戻す`}
          onClick={() => apply(DEFAULT_NOTE_FONT_SCALE)}
          className="inline-flex min-h-9 min-w-14 items-center justify-center rounded text-center tabular-nums transition-colors hover:bg-gray-100 active:bg-gray-200"
        >
          {noteFontScaleLabel(scale)}
        </button>
        <button
          type="button"
          aria-label="大きく"
          disabled={!canGrow}
          onClick={() => apply(stepNoteFontScale(scale, 1))}
          className={STEP_BUTTON_CLASS}
        >
          ＋
        </button>
      </span>
      {/* 押した結果を読み上げる場所。ボタンの名前を変えるだけでは、押した後に
          焦点が当たったままの ＋ / − から新しい倍率が読まれない (名前が
          変わっていないため)。値だけを持つ live region を別に置く */}
      <span aria-live="polite" className="sr-only">
        テキストサイズ {noteFontScaleLabel(scale)}
      </span>
    </div>
  );
}
