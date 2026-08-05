"use client";

import {
  prepareZXingModule,
  Scanner,
  type IDetectedBarcode,
  type IScannerError,
  type IScannerHandle,
  type ScannerErrorKind,
} from "@yudiel/react-qr-scanner";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { SCAN_FORMATS } from "@/lib/scanFormats";
import { resolveScanPath } from "@/lib/scanResult";
import { cameraControlClass } from "./cameraControlButton";
import { useScannerCamera } from "./useScannerCamera";

// 読み取りエンジン (wasm) の取得先を自前配信へ向ける (docs/09-スキャン計画.md §5)。
// 既定は jsDelivr の CDN で、外部依存を作りたくない。
// public/zxing/ へはビルド時に scripts/copyZxingWasm.mjs が複製する。
//
// prepareZXingModule はモジュール読み込み時 = 最初の読み取りより前に呼ぶ必要がある。
// このファイル自体が動的 import されるので、Scanner が描画される前に必ず通る。
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith(".wasm") ? "/zxing/zxing_reader.wasm" : `${prefix}${path}`,
  },
});

// カメラを開けなかった理由。黙って真っ黒な画面を見せると原因を追えないので、
// 何が起きたか・どうすれば直るかまで書く。
// Record にして ScannerErrorKind の追加を型で検出させる (取りこぼし防止)
const ERROR_MESSAGES: Record<ScannerErrorKind, string> = {
  "permission-denied":
    "カメラの使用が許可されていません。ブラウザのサイト設定でカメラを許可してください。",
  "no-camera": "カメラが見つかりません。",
  "in-use": "他のアプリがカメラを使用中です。閉じてからもう一度お試しください。",
  overconstrained: "この端末のカメラでは条件を満たせませんでした。",
  // https でないと getUserMedia 自体が使えない (docs/09-スキャン計画.md §6)
  "insecure-context": "カメラは https でしか使えません。https でアクセスしてください。",
  unsupported: "このブラウザはカメラのスキャンに対応していません。",
  aborted: "カメラの起動が中断されました。",
  security: "セキュリティ設定によりカメラを開けませんでした。",
  "type-error": "カメラの起動に失敗しました。",
  unknown: "カメラを開けませんでした。",
};

interface ScannerModalProps {
  // QR シールに焼かれている URL のホスト (QR_BASE_URL 由来)。
  // 検索モード (onResult なし) のときだけ使う
  stickerHost?: string;
  onClose: () => void;
  // 挿入モード: 読み取った生値をこのコールバックへ渡す。**検索・遷移しない**
  // (docs/13/14 の書誌・商品情報を編集中のエディタへ挿入する導線)。
  // 渡されたときは resolveScanPath / router.push を通らない
  onResult?: (rawValue: string) => void;
  // 見出し (既定「QR・バーコードをかざす」)。挿入モードでは用途を変えたい
  title?: string;
}

// 全画面のカメラビュー。QR / バーコードを 1 つ読んだら閉じる。
// 既定 (検索モード) は遷移先を lib/scanResult.ts の純関数で決めて router.push。
// onResult を渡すと挿入モードになり、読み取った生値を呼び出し側へ返すだけ。
export function ScannerModal({
  stickerHost,
  onClose,
  onResult,
  title = "QR・バーコードをかざす",
}: ScannerModalProps) {
  const router = useRouter();
  // 読み取り成功から unmount までの間に onScan が再び発火しても
  // 二重に処理しないようにする
  const isHandled = useRef(false);
  // <Scanner> の内部ストリームを覗くための handle (getStream)。カメラ操作フックが
  // トーチ・ズームを直接効かせ、内外・近接は constraints で開き直す
  const scannerRef = useRef<IScannerHandle>(null);
  const cam = useScannerCamera(scannerRef);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleScan = (codes: IDetectedBarcode[]) => {
    if (isHandled.current) {
      return;
    }
    const rawValue = codes[0]?.rawValue ?? "";

    // 挿入モード: 遷移せず生値を返すだけ (書籍・商品情報の取得は呼び出し側)
    if (onResult) {
      const value = rawValue.trim();
      if (!value) {
        return; // 空の読み取り。カメラは開けたままにして読み直させる
      }
      isHandled.current = true;
      navigator.vibrate?.(50);
      onClose();
      onResult(value);
      return;
    }

    // シールのホストと、いま開いているホストの両方を部品 URL と認める。
    // 実機確認では localhost や LAN の IP で開きつつ本番シールを読むため
    const path = resolveScanPath(
      rawValue,
      [stickerHost, window.location.hostname].filter((h): h is string => !!h),
    );
    if (!path) {
      return; // 空の読み取り。カメラは開けたままにして読み直させる
    }
    isHandled.current = true;
    // 対応端末だけの振動。読めた手応えを返す (非対応でも何も起きないだけ)
    navigator.vibrate?.(50);
    onClose();
    router.push(path);
  };

  // カメラを開けなかったときの表示と復帰はフックに任せる (切替に失敗したら
  // 最後に写っていたカメラへ戻り、開き直せたらエラー表示も畳まれる)
  const handleError = (e: IScannerError) => {
    cam.notifyOpenFailed(ERROR_MESSAGES[e.kind] ?? ERROR_MESSAGES.unknown);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
      <div className="flex items-center justify-between p-3 text-white">
        <span>{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded bg-white/20 px-4 py-2 font-medium"
          aria-label="スキャンを閉じる"
        >
          閉じる
        </button>
      </div>

      {/* min-h-0 + overflow-y-auto … エラー文とカメラ枠が並ぶと、スマホ横持ち
          (視界 300px 台) では入り切らないことがある (docs/31 §12)。器の中を
          スクロールできるようにしておく (ImageSearchModal と同じ作り)。
          縦の中央寄せは justify-center ではなく内側の my-auto で行う —
          justify-center はあふれた分が上下とも画面外に出て、スクロールしても
          上端に届かない (auto マージンはあふれると 0 に潰れるので安全) */}
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-4">
        <div className="my-auto flex w-full flex-col items-center gap-3">
          {/* エラーは Scanner を差し替えず上に出す。差し替えるとカメラ起動失敗の
              たびにツリーが入れ替わり、復帰できない。起動に失敗したときは Scanner
              側が黒いままなので、これで困らない。なお下部バーのトーチ・ズームは
              自前トラック操作で失敗を握りつぶす (useScannerCamera) ので、ここには
              出さない */}
          {cam.error && (
            <p
              role="alert"
              className="max-w-sm rounded bg-red-900/80 px-3 py-2 text-center text-white"
            >
              {cam.error}
            </p>
          )}
          {/* 自動で退避した知らせ (近接に切り替えられず外側へ戻した等)。
              押したのに違うカメラが写る理由が判らないと、壊れたと受け取られる。
              エラーではない (カメラは写っている) ので赤くしない */}
          {cam.note && (
            <p
              aria-live="polite"
              className="max-w-sm rounded bg-white/20 px-3 py-2 text-center text-white"
            >
              {cam.note}
            </p>
          )}
          {/* max-w は 28rem に加えて視界の高さ (dvh) でも縛る。スマホ横持ちでは
              高さが 300px 台になり、幅 28rem のカメラ映像 (4:3 で高さ 336px) が
              画面から溢れる (docs/31 §12)。幅 ≤ 75dvh なら 4:3 でも高さ ≤ 56dvh
              で、上の見出し行と合わせても収まる */}
          <div className="w-full max-w-[min(28rem,75dvh)]">
            <Scanner
              ref={scannerRef}
              formats={SCAN_FORMATS}
              onScan={handleScan}
              onError={handleError}
              // 内外・近接は constraints の差で開き直す (useScannerCamera)。
              // トーチ・ズームはライブラリ内蔵オーバーレイを使わず、下部バーの
              // 自前ボタンから生きているトラックへ直接効かせる (録画バーと統一)。
              //
              // **torch: false を明示する**。ライブラリは既定値と浅くマージし、
              // torch の既定は true — 省いただけでは内蔵トーチが残り、自前の
              // 「ライト」と二つ並ぶ。互いの ON/OFF を知らないので表示も食い違う
              constraints={cam.constraints}
              components={{ finder: true, torch: false }}
              // 内側カメラは表示だけ鏡像に (検出は生ストリームなので影響しない)。
              // 録画モーダルと同じ見え方に揃える
              classNames={{
                container: "overflow-hidden rounded",
                video: cam.facing === "user" ? "-scale-x-100" : "",
              }}
            />
          </div>
        </div>
      </div>

      {/* 下部バー: カメラアプリ風にカメラ操作を並べる (VideoRecordModal と同じ
          cameraControlClass / 配置)。対応端末でだけボタンが現れる。safe-area で
          ホームバーに潜らせない */}
      <div className="flex items-end justify-between gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* 内側/外側カメラ切替。ラベルは切り替え先を示す */}
          <button
            type="button"
            onClick={cam.toggleFacing}
            className={cameraControlClass(false)}
          >
            {cam.facing === "environment" ? "内カメラ" : "外カメラ"}
          </button>
          {/* 近接 = 超広角レンズ。外側で超広角を持つ端末のみ */}
          {cam.facing === "environment" && cam.canNearFocus && (
            <button
              type="button"
              onClick={cam.toggleNearFocus}
              aria-pressed={cam.nearFocus}
              className={cameraControlClass(cam.nearFocus)}
            >
              {cam.nearFocus ? "近接 ON" : "近接"}
            </button>
          )}
        </div>

        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          {cam.canTorch && (
            <button
              type="button"
              onClick={cam.toggleTorch}
              aria-pressed={cam.torchOn}
              className={cameraControlClass(cam.torchOn)}
            >
              {cam.torchOn ? "ライト ON" : "ライト"}
            </button>
          )}
          {cam.zoomLevels.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => cam.setZoom(level)}
              aria-pressed={cam.zoom === level}
              className={cameraControlClass(cam.zoom === level)}
            >
              {level}x
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
