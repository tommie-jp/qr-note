"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { ImageSearchIcon, ScanIcon } from "@/components/MenuIcons";
import { COMPACT_ICON_BUTTON_CLASS } from "@/components/ui";

interface SearchToolsProps {
  // QR シールに焼かれているホスト。ScannerModal へ渡す
  stickerHost: string;
}

// スキャナ・画像検索はカメラと重いエンジン (wasm 約 1MB / 埋め込みモデル数十MB)
// を抱えるので、ボタンを押すまで一切読み込まない
// (docs/09-スキャン計画.md §2、docs/25-画像検索計画.md)。
// ssr: false … camera / document を触るのでサーバでは描画できない
const ScannerModal = dynamic(
  () => import("@/components/ScannerModal").then((m) => m.ScannerModal),
  { ssr: false },
);

const ImageSearchModal = dynamic(
  () => import("@/components/ImageSearchModal").then((m) => m.ImageSearchModal),
  { ssr: false },
);

// 隣の虫眼鏡・＋ (StrokeIcon) と同じ 20px。スキャン・画像検索のアイコンは
// 帯のスロット用に 24px で描かれているので、この行だけ縮める
const TOOL_ICON_SIZE_CLASS = "size-5 shrink-0";

// 検索窓の左に置く「別の入口で探す」2 つ (docs/86 §4-15)。
//
// **もとは画面下端の固定バー (BottomActionBar) だった** (docs/31-下部操作バー
// 計画.md)。片手持ちの親指が届くのは画面の下側、という理由で下に置いていたが、
// 3 ペインになって事情が変わった:
//
//   - 表示・並び順・選択が見出し行へ抜けた (docs/86 §4-11) 結果、帯に残るのは
//     この 2 つだけになり、**2 つのために画面の下端を 49px 使い続けていた**。
//   - 帯は画面の一番下 = ノートのペインのさらに下にあり、一覧にもノートにも
//     属さない場所に浮いていた。
//
// どちらも「検索語の代わりにカメラで探す」入口なので、検索窓の隣が本来の
// 居場所になる。虫眼鏡・＋ と同じ 36px 角に揃えて 1 行に収める。
//
// **文字は持たせない。** 帯のスロットはアイコン + 小ラベルの等幅だったが、
// 検索窓の行に文字を 4 つ (スキャン・画像検索) 足すと、320px では窓が潰れる。
// 意味は aria-label / title で言う (虫眼鏡・＋ と同じ作法)。
export function SearchTools({ stickerHost }: SearchToolsProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [isImageSearching, setIsImageSearching] = useState(false);

  return (
    <>
      {/* カメラ非対応の環境でも隠さない。押したとき理由を出す方が原因を
          追える (docs/09-スキャン計画.md §6) */}
      {/* 色は**中の span が持つ**。ボタン側に text-sky-600 を足すと、
          COMPACT_ICON_BUTTON_CLASS が持つ text-gray-700 と同種のユーティリティ
          どうしになり、勝敗が class 属性の並び順ではなく生成 CSS の並び順で
          決まる (ui.ts の STATE_TOGGLE_CLASS が踏んだのと同じ罠)。
          別の要素に載せれば継承で必ず勝つ。
          サイズは 20px を明示 — 隣の虫眼鏡・＋ と揃える (既定は帯用の 24px) */}
      <button
        type="button"
        onClick={() => setIsScanning(true)}
        aria-label="スキャン"
        title="スキャン"
        className={COMPACT_ICON_BUTTON_CLASS}
      >
        <span className="flex text-sky-600">
          <ScanIcon sizeClass={TOOL_ICON_SIZE_CLASS} />
        </span>
      </button>

      {/* 部品を映して登録済みの写真と照合する (docs/25-画像検索計画.md) */}
      <button
        type="button"
        onClick={() => setIsImageSearching(true)}
        aria-label="画像検索"
        title="画像検索"
        className={COMPACT_ICON_BUTTON_CLASS}
      >
        <span className="flex text-violet-600">
          <ImageSearchIcon sizeClass={TOOL_ICON_SIZE_CLASS} />
        </span>
      </button>

      {/* モーダルはこの 2 つと同じ階層でよい。**帯にあった頃は nav の外へ
          出す必要があった** — nav の backdrop-blur が position:fixed の
          包含ブロックになり、中に置くと inset-0 が帯の矩形を指したため。
          検索窓の行は backdrop-filter も transform も持たないので、
          その制約はここには無い */}
      {isScanning && (
        <ScannerModal
          stickerHost={stickerHost}
          onClose={() => setIsScanning(false)}
        />
      )}
      {isImageSearching && (
        <ImageSearchModal onClose={() => setIsImageSearching(false)} />
      )}
    </>
  );
}
