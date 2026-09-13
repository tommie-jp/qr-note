// 受け付ける音声形式の**唯一の出どころ** (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)。
//
// この一覧は、判定・保存名・表示・OCR 除外・ファイル選択と 5 か所で要る。
// かつては各所に拡張子を並べていたが、webm を足すときに全部を手で直す羽目に
// なった。**足し忘れは例外にならず黙って壊れる** (その形式だけ <audio> に
// ならない・OCR に回ってしまう) ので、一覧はここ 1 つにする。
//
// MIME の一覧はここに置かない。サーバの保存 mime (uploads.ts の
// AUDIO_MIME_TO_EXT) とファイル選択ダイアログのヒント (MemoEditorInner の
// ACCEPTED_AUDIO_TYPES) は**意図的に食い違わせている** — 後者は
// audio/x-m4a のような別名まで許して選ばせ、実際の可否はサーバが中身を見て
// 決める。無理に 1 つにすると、その遊びが失われる。

export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav', 'webm'] as const

export type AudioFormat = (typeof AUDIO_EXTENSIONS)[number]

// 正規表現に埋める用の "mp3|m4a|wav|webm"。拡張子は英数字だけなので
// 正規表現のエスケープは要らない (増やすときもその範囲に収めること)
export const AUDIO_EXTENSION_ALTERNATION = AUDIO_EXTENSIONS.join('|')
