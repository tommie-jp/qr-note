// 画像埋め込みモデルの設定 (docs/25-画像検索計画.md §2)。
//
// ここは定数だけを置く軽いモジュールで、ブラウザ・Node・テストのどこから
// import してもよい (transformers.js やモデル本体は読み込まない)。
// **ストック側 (保存時・バックフィル) とクエリ側 (カメラ) は必ず同じ設定を
// 使う**。モデルや量子化を変えたら全画像の embedding を作り直すこと。

// 第一候補: DINOv2-small (自己教師あり、個体識別に強い)。
// 速度が足りなければ 'Xenova/mobileclip_s0' へ差し替える (要 embedding 再生成)。
export const EMBEDDING_MODEL_ID = 'Xenova/dinov2-small'

// 量子化。q8 はサイズ・速度と精度の釣り合いが良い (調査メモ)。
export const EMBEDDING_DTYPE = 'q8'

// 出力ベクトルの次元。DINOv2-small は 384。索引・DB の器の想定に使う
// (MobileCLIP に替えるなら 512 に直す)。
export const EMBEDDING_DIM = 384
