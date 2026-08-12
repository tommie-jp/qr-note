import { isDemoMode, isProductionEnv } from "./appEnv";

// サイト名と説明文は <head> の metadata と PWA manifest の両方が使う。
// 別々に書くと表示名がじわじわ食い違うため、ここを唯一の出どころにする。
export const SITE_NAME = "QR Note";
export const SITE_DESCRIPTION = "部品に貼った QR シールから部品情報を表示・管理する";

// タブと PWA のホーム画面に出す表示名。非本番は [LOCAL]、デモは [DEMO] を冠する。
//
// 画面をピンクに塗るだけでは、タブを何枚も開いているときに背景が見えず
// 誤認を防げない。タブの一覧で本番と見分けられるのはタイトルだけなので、
// 色と対で入れる (src/lib/appEnv.ts)。
//
// [DEMO] と [LOCAL] は独立した軸なので合成する (docs/38-デモモード計画.md §6)。
// デモは本番相当 (APP_ENV=production) で立てるので通常は「[DEMO] QR Note」、
// ローカルでデモを検証するときだけ「[LOCAL] [DEMO] QR Note」になる。
export function siteTitle(): string {
  const base = isDemoMode() ? `[DEMO] ${SITE_NAME}` : SITE_NAME;
  return isProductionEnv() ? base : `[LOCAL] ${base}`;
}

const DEFAULT_QR_BASE_URL = "https://qr.tommie.jp";

// QR シールに焼く URL の起点。印刷 (/print) が埋め込む先であり、
// スキャン (ScannerModal) が「これは部品シールだ」と判定する相手でもあるので、
// 両者がずれないようここを唯一の出どころにする。
//
// サーバ専用。process.env は NEXT_PUBLIC_ 以外クライアントへ渡らないため、
// 必要な値はサーバコンポーネントから props で降ろす。
//
// ?? ではなく || なのは、.env に `QR_BASE_URL=` と書くと undefined ではなく
// 空文字が来るため。?? は空文字を素通しし、既定へ倒れない
export function qrBaseUrl(): string {
  return process.env.QR_BASE_URL || DEFAULT_QR_BASE_URL;
}

// シールに焼かれた URL のホスト。スキャンの判定に使う (docs/09-スキャン計画.md §3)。
//
// 設定ミスで検索まで巻き込まないよう、ここでは投げない。QR_BASE_URL が
// URL として壊れていても (scheme 忘れなど)、トップページは検索のための
// ページであって印刷設定とは関係がなく、道連れに 500 にする理由がない。
// 既定へ倒したうえでサーバログに警告を残す。
export function qrStickerHost(): string {
  try {
    return new URL(qrBaseUrl()).hostname;
  } catch {
    console.warn(
      `QR_BASE_URL が URL として不正なため既定 (${DEFAULT_QR_BASE_URL}) を使う: ` +
        `${JSON.stringify(process.env.QR_BASE_URL)}`,
    );
    return new URL(DEFAULT_QR_BASE_URL).hostname;
  }
}
