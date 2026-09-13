// テキスト添付の受け入れ判定と正規化 (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)。
//
// **画像・音声・PDF と違い、テキストには先頭バイトの署名が無い。** そのため
// 「これはテキストか」を積極的に確かめるしかなく、判定は 2 段構えにする:
//
//   1. 対応する文字コードで**厳密に**デコードできること (fatal: true)
//   2. デコード結果に制御文字が無いこと (タブ・改行を除く)
//
// 2 が要点。実行ファイルや ZIP (docx/xlsx の実体) は 1 を運よく抜けることが
// あっても、C0 制御文字をほぼ必ず含むのでここで落ちる。拡張子を .txt に
// 偽装したバイナリを受けないための砦になっている。
//
// 受け付けたものは **UTF-8 に正規化してから保存する** (HEIC を WebP へ直すのと
// 同じ流儀)。保存時に 1 通りへ寄せておけば、配信は常に charset=utf-8 で済み、
// 表示側が文字コードを推測する必要が無くなる。

// 試す文字コードと**その順番**。UTF-8 を先に見る。
// Shift_JIS を足しているのは、Windows で書き出した日本語 CSV が今もこの形で
// 出てくるため。順番を逆にしてはいけない — UTF-8 の日本語は Shift_JIS
// としても「読めてしまう」ことがあり、先に試したほうが勝ってしまう
const ENCODINGS = ['utf-8', 'shift_jis'] as const

// BOM から UTF-16 と判別できるときに使う文字コード。
//
// **UTF-16 は BOM が付いているときだけ受ける。** BOM 無しの UTF-16 は
// ほぼどんなバイト列でも「デコードできて」しまい (UTF-16 に不正な並びが
// ほぼ無いため)、binary をテキストとして取り込みかねない。先頭 2 バイトの
// BOM (`FF FE` / `FE FF`) があれば UTF-16 だと曖昧さなく決まる
// (UTF-8 は FF で始まれず、Shift_JIS も FF は不正なので取り違えない)。
//
// なぜ要るか: Excel や一部ツール・iOS 上のアプリ (iCloud 同期や Numbers 等で
// 開き直した CSV) が UTF-16 で書き出すことがある。PC では UTF-8/Shift_JIS
// だった同じ CSV が、別環境では UTF-16 になっていて弾かれる
// (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)。
function bomEncoding(bytes: Uint8Array): string | null {
  if (bytes.byteLength < 2) {
    return null
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return 'utf-16le'
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return 'utf-16be'
  }
  return null
}

// UTF-16 の BOM を持つか。
//
// 呼び出し側 (attachmentStore) が**音声判定より先にテキストを確定させる**ために
// 見る。UTF-16LE の BOM `FF FE` は、緩い MP3 判定 (先頭 FF + 次バイトの上位
// 3bit が同期語) に音声として横取りされてしまう — `FF FE` は MPEG1 Layer II の
// 同期語としても妥当なので、音声判定を弱めては直せない。BOM という強い署名が
// あるうちにテキストへ寄せるのが安全 (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)。
export function hasUtf16Bom(bytes: Uint8Array): boolean {
  return bomEncoding(bytes) !== null
}

// 許すのはタブ (09)・改行 (0A)・復帰 (0D) だけ。他の制御文字が 1 つでも
// あればテキストとして扱わない (NUL を含むバイナリはここで落ちる)。
// DEL (7F) と C1 (80-9F) まで見るのは、**デコード後の文字**で判定しているため —
// C1 は UTF-8 では 2 バイト列として「正しく」デコードされてしまい、
// C0 だけ見ていると素通りする
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/

// 指定の文字コードで厳密にデコードする。1 バイトでも不正なら null。
// **fatal: true が肝** — 既定の置換文字 (U+FFFD) 任せだと、どんなバイト列でも
// 「デコードできた」ことになってしまい判定にならない
function decodeStrict(bytes: Uint8Array, encoding: string): string | null {
  try {
    // ignoreBOM は既定の false のまま = BOM は読み飛ばされる。
    // BOM 付き CSV (Excel の書き出し) をそのまま受け、保存では落とせる
    return new TextDecoder(encoding, { fatal: true }).decode(bytes)
  } catch {
    // このエンコーディングでは読めなかった (壊れている or 別の文字コード)
    return null
  }
}

// テキストとして受け付けられるなら UTF-8 に正規化したバイト列を、
// 受け付けられないなら null を返す。**例外は投げない** (呼び出し側の
// attachmentStore は「次の形式を試す」だけなので、判定は真偽で足りる)。
export function normalizeTextBytes(
  bytes: Uint8Array,
): Uint8Array<ArrayBuffer> | null {
  // 空ファイルは中身が無く、表示しても何も出ない。テキストと名乗る根拠も
  // 無いので受けない (バイナリの空ファイルと区別が付かない)
  if (bytes.byteLength === 0) {
    return null
  }

  // BOM で UTF-16 と判ればそれだけを試す。判別が付いている以上、外れたら
  // (制御文字が出たら) テキストではないと結論してよく、utf-8/shift_jis へ
  // 落とす意味はない (FF/FE 始まりはどちらでも読めない)
  const bom = bomEncoding(bytes)
  const encodings = bom ? [bom] : ENCODINGS

  for (const encoding of encodings) {
    const text = decodeStrict(bytes, encoding)
    if (text === null) {
      continue
    }
    // 読めても中身がバイナリなら受けない。**次の文字コードは試さない** —
    // 「読めたが制御文字がある」= テキストではない、と結論できるため
    return CONTROL_CHARS.test(text) ? null : new TextEncoder().encode(text)
  }
  return null
}
