"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { ImageSearchIcon, ScanIcon } from "@/components/MenuIcons";
import { SlotIcon } from "@/components/SlotIcon";
import {
  BOTTOM_BAR_CLASS,
  BOTTOM_BAR_INNER_NARROW_CLASS,
  BOTTOM_BAR_SLOT_CLASS,
  BOTTOM_BAR_SPACER_CLASS,
} from "@/components/ui";

interface BottomActionBarProps {
  // QR シールに焼かれているホスト。ScannerModal へ渡す
  stickerHost: string;
  // 非本番はヘッダーと同じくピンクに塗る。process.env はクライアントに
  // 渡らないのでサーバから降ろす (layout.tsx と同じ判断)
  isProd: boolean;
}

// スキャナ・画像検索はカメラと重いエンジン (wasm 約 1MB / 埋め込みモデル数十MB)
// を抱えるので、ボタンを押すまで一切読み込まない
// (docs/09-スキャン計画.md §2、docs/25-画像検索計画.md)。
// 以前は SearchForm が持っていたが、ボタンがこのバーへ移ったので所有権も移す。
// ssr: false … camera / document を触るのでサーバでは描画できない
const ScannerModal = dynamic(
  () => import("@/components/ScannerModal").then((m) => m.ScannerModal),
  { ssr: false },
);

const ImageSearchModal = dynamic(
  () => import("@/components/ImageSearchModal").then((m) => m.ImageSearchModal),
  { ssr: false },
);

// 検索画面の主要操作を画面下端にまとめた固定バー (docs/31-下部操作バー計画.md)。
//
// 片手持ちの親指が届くのは画面の下側で、届きにくいのは左右ではなく高さ
// (docs/11-アプリ的UIUX計画.md §8-4 でハンバーガーメニューをボトムシートに
// したのと同じ理由)。散っていた 3 行 (検索窓の行・件数の行・一覧の直上) を
// 1 本に集約し、空いた縦幅を一覧の件数に回す。
//
// スロットはアイコン + 小ラベルの等幅。テキストボタンのまま並べると
// 実測で 450px 必要になり 320px にも 375px にも入らない (docs/31 §3-1)。
//
// **残っているのはスキャンと画像検索だけ** (docs/86 §4-11)。表示・並び順・
// 選択は一覧に効く操作なので、検索結果の見出し行 (ResultsToolbar) へ移した —
// 3 ペインではバーが画面の一番下 = ノートのペインの下にあり、どのペインに
// 効くのか判らなかった。ゴミ箱のバー (TrashActionBar) は 1 画面 1 一覧なので
// 従来どおり表示・並び順を帯に持つ。
export function BottomActionBar({ stickerHost, isProd }: BottomActionBarProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [isImageSearching, setIsImageSearching] = useState(false);

  return (
    <>
      {/* バーぶんの余白。これがないと一覧の最終行とページ送りがバーに隠れる。
          3 ペインの器 (lg 以上) では要らない — 器自身が margin でバーのぶんを
          空けているので、置いたままだと一覧の下に同じ幅の死んだ余白が残る
          (globals.css が data-bottom-bar-spacer を目印に畳む) */}
      <div aria-hidden data-bottom-bar-spacer className={BOTTOM_BAR_SPACER_CLASS} />

      <nav
        aria-label="操作"
        className={`${BOTTOM_BAR_CLASS} ${
          isProd ? "border-gray-200 bg-white/95" : "border-pink-300 bg-pink-100/95"
        }`}
      >
        <div className={BOTTOM_BAR_INNER_NARROW_CLASS}>
          {/* 戻る/進む (◀ ▶) はここにあったが、ヘッダーへ移した
              (docs/11 §5-2)。5 スロットだけの帯に戻る */}
          {/* カメラ非対応の環境でも隠さない。押したとき理由を出す方が
              原因を追える (docs/09-スキャン計画.md §6) */}
          <button
            type="button"
            onClick={() => setIsScanning(true)}
            className={`${BOTTOM_BAR_SLOT_CLASS} text-gray-700`}
          >
            <SlotIcon color="text-sky-600">
              <ScanIcon />
            </SlotIcon>
            スキャン
          </button>

          {/* 部品を映して登録済みの写真と照合する (docs/25-画像検索計画.md) */}
          <button
            type="button"
            onClick={() => setIsImageSearching(true)}
            className={`${BOTTOM_BAR_SLOT_CLASS} text-gray-700`}
          >
            <SlotIcon color="text-violet-600">
              <ImageSearchIcon />
            </SlotIcon>
            画像検索
          </button>

        </div>
      </nav>

      {/* モーダルは **nav の外** に置く。nav は backdrop-blur を持ち、
          backdrop-filter のある要素は position:fixed の包含ブロックになるため、
          中に入れると inset-0 が「バーの矩形」を指して画面全体に広がらない
          (HeaderMenu が覆いとシートを portal している理由と同じ) */}
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
