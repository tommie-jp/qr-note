// スキャナ (@yudiel/react-qr-scanner の <Scanner>) へ渡す MediaTrackConstraints
// を、いま選ばれているカメラ状態から純粋に組み立てる。<Scanner> は constraints が
// 変わるとカメラを開き直すので、内/外切替も近接 (超広角) 切替もここが返す値の差で
// 表現できる (docs/09-スキャン計画.md の Phase 2)。
//
// **近接 = 超広角レンズを deviceId で名指しする**。ライブラリは deviceId があると
// 既定の facingMode を落とすため、近接時は facingMode を併記しても無駄で、
// deviceId 単独になる。iOS が deviceId を前面カメラに誤解決する癖は、開き直した
// 後にトラックを isFrontFacing で検証して呼び出し側が畳む
// (docs/16 / メモリ「iOS は deviceId を前面カメラに誤解決する」)。

import type { CameraFacing } from "./videoRecorder";

export interface ScannerCameraTarget {
  // いま内側 (user) / 外側 (environment) どちらを狙っているか
  facing: CameraFacing;
  // 近接 (超広角) を狙っているか
  nearFocus: boolean;
  // 背面超広角カメラの deviceId (無い端末は null)
  ultraWideId: string | null;
}

// 「どのカメラを狙っているか」だけを表す (deviceId は組み立て時に足す)
export type ScannerCameraAim = Pick<
  ScannerCameraTarget,
  "facing" | "nearFocus"
>;

// 近接かつ超広角 deviceId があるときだけ deviceId 名指し、それ以外は facingMode。
// facingMode は bare string = ideal 扱いなので、単眼 PC でも overconstrained に
// ならず同じカメラのままになる (内/外ボタンを常時出しても安全)。
export function buildScannerConstraints(
  target: ScannerCameraTarget,
): MediaTrackConstraints {
  if (target.nearFocus && target.ultraWideId) {
    return { deviceId: { exact: target.ultraWideId } };
  }
  return { facingMode: target.facing };
}

// カメラを開き直せなかったときに戻る先を決める。lastGood は最後に**実際に開けた**
// 狙い。切替を試みた瞬間に state だけ進めてしまうと、開けなかったときに画面は
// 真っ黒なのにボタンだけ切替後を指す (どのカメラが生きているか判らなくなる)。
//
// 戻り先が無い (初回起動の失敗) か、いまの狙いがその最後に開けたもの自身なら
// null = 何もしない。後者を通すと、同じ constraints を投げ直しても <Scanner> は
// 開き直さない (deepEqual) ため復帰できないまま、失敗のたびに戻す輪だけが残る。
export function rollbackTarget(
  current: ScannerCameraAim,
  lastGood: ScannerCameraAim | null,
): ScannerCameraAim | null {
  if (!lastGood) {
    return null;
  }
  const isSameAim =
    lastGood.facing === current.facing &&
    lastGood.nearFocus === current.nearFocus;
  return isSameAim ? null : lastGood;
}
