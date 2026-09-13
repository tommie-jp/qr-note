// 受け付けるテキスト形式の**唯一の出どころ** (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)。
//
// audioFormats.ts と同じ役割。この一覧は判定・保存名・表示・OCR 除外・
// ファイル選択と 5 か所で要り、**足し忘れは例外にならず黙って壊れる**
// (その形式だけビューアに振り分かない・OCR に回ってしまう) ため 1 つにまとめる。
//
// この 3 つに絞るのは安全のためでもある。テキストには署名が無く「中身が
// テキストか」しか判定できないので、HTML や SVG も素通りする。**保存名の
// 拡張子をここに限り、text/plain 系 + nosniff で配る**ことで、
// スクリプトとして解釈される経路そのものを塞いでいる (uploads.ts textSaveInfo)。

export const TEXT_EXTENSIONS = ['txt', 'csv', 'md'] as const

export type TextFormat = (typeof TEXT_EXTENSIONS)[number]

// 正規表現に埋める用の "txt|csv|md"。拡張子は英数字だけなので
// 正規表現のエスケープは要らない (増やすときもその範囲に収めること)
export const TEXT_EXTENSION_ALTERNATION = TEXT_EXTENSIONS.join('|')
