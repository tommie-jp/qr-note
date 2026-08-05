// カメラアプリ風の下部バーに並べる補助ボタンの見た目。黒背景に合わせた半透明で、
// 押下状態 (トーチ ON・現在のズーム段・近接 ON) は白反転で示す。録画
// (VideoRecordModal) とスキャン (ScannerModal) の両方で使い、見た目を揃える。
export function cameraControlClass(active: boolean): string {
  return `min-h-11 rounded px-3 font-medium transition-colors disabled:opacity-40 ${
    active ? "bg-white text-black" : "bg-white/20 text-white"
  }`;
}
