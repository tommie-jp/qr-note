"use client";

import { useState } from "react";
import { ScanBeepIcon } from "@/components/icons";
import { HEADER_MENU_ROW_CLASS } from "@/components/ui";
import { scanBeepDataUri } from "@/lib/audio/scanBeepWav";
import { logDiagEvent } from "@/lib/logging/diagLog";
import { browserStorage } from "@/lib/prefs/storagePref";
import {
  DEFAULT_SCAN_BEEP_LEVEL,
  loadScanBeepLevel,
  saveScanBeepLevel,
  scanBeepAmplitude,
  scanBeepLabel,
  stepScanBeepLevel,
  type ScanBeepLevel,
} from "@/lib/prefs/scanBeepVolume";

// ハンバーガーメニューの「スキャン音」(docs/112-スキャン音量計画.md)。
//
// QR・バーコードを読めたときのピッの大きさを − / ＋ で 1 段ずつ変える。
// 形はテキストサイズ (TextSizeMenuItem.tsx) と揃える — 同じメニューに
// 段送りとスライダーが並ぶと流儀が割れる。
//
// 保存は localStorage (端末ごと)。スキャナは開くたびに読むので、
// ここは保存するだけで済み、初回描画前のスクリプトも要らない (見た目に出ない)。
//
// **押すたびに新しい音量で 1 回鳴らす。** テキストサイズは覆いの向こうで
// 本文が変わるのが見えるが、音量は見えない。閉じてスキャンするまで結果が
// 判らないのでは選べない。押した操作の中で鳴らすので iOS でも鳴る

// size-9 … 行の高さ (HEADER_MENU_ROW_CLASS の min-h-9) と揃える
// (TextSizeMenuItem と同じ)
const STEP_BUTTON_CLASS =
  "inline-flex size-9 items-center justify-center rounded text-xl text-gray-700 transition-colors hover:bg-gray-100 active:bg-gray-200 disabled:text-gray-300 disabled:hover:bg-transparent";

function previewBeep(level: ScanBeepLevel): void {
  if (level === "off" || typeof Audio === "undefined") {
    return;
  }
  // 試し鳴りは手応えであって本筋ではない。鳴らなくても段は変わっている。
  // ただし黙って捨てず、iPhone で鳴らない理由を後から読めるよう残す
  new Audio(scanBeepDataUri(scanBeepAmplitude(level)))
    .play()
    .catch((error: unknown) => {
      logDiagEvent(`[スキャン音] 試し鳴りに失敗: ${String(error)}`);
    });
}

export function ScanBeepMenuItem() {
  const [level, setLevel] = useState<ScanBeepLevel>(() =>
    typeof window === "undefined"
      ? DEFAULT_SCAN_BEEP_LEVEL
      : loadScanBeepLevel(browserStorage()),
  );

  const apply = (next: ScanBeepLevel) => {
    setLevel(next);
    saveScanBeepLevel(browserStorage(), next);
    previewBeep(next);
  };

  const canLower = stepScanBeepLevel(level, -1) !== level;
  const canRaise = stepScanBeepLevel(level, 1) !== level;
  const label = scanBeepLabel(level);

  return (
    // クリックをここで止める。素通しするとメニューのシートが閉じ、
    // 続けて押し比べられない (TextSizeMenuItem と同じ扱い)
    <div
      className={`${HEADER_MENU_ROW_CLASS} flex-wrap justify-between`}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="flex items-center gap-2">
        <ScanBeepIcon />
        スキャン音
      </span>
      <span className="-mr-3 flex shrink-0 items-center">
        <button
          type="button"
          aria-label="スキャン音を小さく"
          disabled={!canLower}
          onClick={() => apply(stepScanBeepLevel(level, -1))}
          className={STEP_BUTTON_CLASS}
        >
          −
        </button>
        {/* ＋ / − の名前に「スキャン音を」を付けるのは、すぐ上のテキストサイズの
            行も「小さく」「大きく」を持つため。読み上げで区別できなくなる。
            今の段。押すと既定 (大) に戻る。aria-label に段も入れる —
            用途だけにすると、画面に出ている今の段が読み上げから消える */}
        <button
          type="button"
          aria-label={`${label}。押すと${scanBeepLabel(DEFAULT_SCAN_BEEP_LEVEL)}に戻す`}
          onClick={() => apply(DEFAULT_SCAN_BEEP_LEVEL)}
          className="inline-flex min-h-9 min-w-14 items-center justify-center rounded text-center transition-colors hover:bg-gray-100 active:bg-gray-200"
        >
          {label}
        </button>
        <button
          type="button"
          aria-label="スキャン音を大きく"
          disabled={!canRaise}
          onClick={() => apply(stepScanBeepLevel(level, 1))}
          className={STEP_BUTTON_CLASS}
        >
          ＋
        </button>
      </span>
      {/* 押した結果を読み上げる場所 (TextSizeMenuItem と同じ理由) */}
      <span aria-live="polite" className="sr-only">
        スキャン音 {label}
      </span>
    </div>
  );
}
