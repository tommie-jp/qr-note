// heic-decode (HEIC/HEIF を RGBA へ復号する) の型。
//
// 実体は CJS (`module.exports = one; module.exports.all = all;`) で型を持たない。
// HEIC 変換 (src/lib/images/normalizeImage.ts, docs/26-画像形式対応計画.md §3) で使う
// 最小限だけ宣言する。上流が型を同梱したらこのファイルは消す。
declare module "heic-decode" {
  interface DecodedImage {
    width: number;
    height: number;
    // RGBA の生画素 (4ch)。sharp({ raw }) にそのまま渡せる
    data: ArrayBuffer;
  }

  interface DecodeInput {
    // Buffer / Uint8Array いずれも受ける
    buffer: Uint8Array;
  }

  // コンテナを解析しただけの画像ハンドル。width/height は画素を復号せず
  // メタデータから得られるので、decode() (画素確保) の前に寸法を検査できる。
  interface ImageHandle {
    width: number;
    height: number;
    decode(): Promise<DecodedImage>;
  }

  // all() の戻り値。使い終わったら dispose() で libheif の確保を解放する
  interface ImageHandleList extends Array<ImageHandle> {
    dispose(): void;
  }

  // 先頭画像 1 枚を復号する (既定エクスポート)
  function decode(input: DecodeInput): Promise<DecodedImage>;

  // 全画像のハンドルを返す (復号は遅延)。寸法の先読みに使う
  export function all(input: DecodeInput): Promise<ImageHandleList>;

  export default decode;
}
