"use client";

import dynamic from "next/dynamic";

// SecretTools がぶら下げるお絵かき・スキャンのモーダル (docs/128 §8-1 で分けた)。
// 開いている間だけ描く判断は呼ぶ側の真偽をそのまま使う

// 重い部品は開くまで読まない (編集画面と同じ流儀)
const DrawModal = dynamic(() => import("@/components/draw/DrawModal"), {
  ssr: false,
  loading: () => null,
});

const ScannerModal = dynamic(
  () => import("@/components/camera/ScannerModal").then((m) => m.ScannerModal),
  { ssr: false, loading: () => null },
);

export function SecretDrawModal({
  open,
  onCancel,
  onInsert,
}: {
  open: boolean;
  onCancel: () => void;
  onInsert: (file: File, alt: string) => void;
}) {
  if (!open) {
    return null;
  }
  return (
    <DrawModal
      // 下敷きにできる画像は渡さない。断片内の画像は Blob URL でしか
      // 出せず、下敷きの取り込み経路 (URL 取得) とは噛み合わないため
      sourceImageUrl={null}
      onCancel={onCancel}
      onInsert={onInsert}
    />
  );
}

// スキャンは**読み取った文字を入れるだけ**。書誌・商品情報の取得は
// しない — コードを自サーバと外部 API へ送ることになり、「何を
// スキャンしたか」が管理者に見えてしまう (docs/53 §1)
export function SecretScanModal({
  open,
  onClose,
  onCode,
}: {
  open: boolean;
  onClose: () => void;
  // 前後の空白を落として空でなければ呼ぶ
  onCode: (code: string) => void;
}) {
  if (!open) {
    return null;
  }
  return (
    <ScannerModal
      title="コードをかざす (情報の取得はしません)"
      onClose={onClose}
      onResult={(rawValue) => {
        onClose();
        const code = rawValue.trim();
        if (code !== "") {
          onCode(code);
        }
      }}
    />
  );
}
