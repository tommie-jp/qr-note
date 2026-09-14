"use client";

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useMemo, useRef, useState, type RefObject } from "react";
import { useLatest } from "@/components/hooks/useLatest";
import { uploadImageWithProgress } from "@/components/uploadImageXhr";
import {
  attachmentAlt,
  attachmentKind,
  ignoredFilesMessage,
  isVideoFile,
  pickFiles,
  shouldMakeThumbs,
} from "@/lib/editor/attachmentKinds";
import { insertText, replaceToken } from "@/lib/editor/cmDoc";
import { errorText } from "@/lib/errorMessage";
import type { UploadProgress } from "@/lib/progressLabels";
import { canShrink, shrinkImageFile } from "@/lib/images/shrinkImage";
import { uploadTooLargeMessage } from "@/lib/uploads/uploadSizeCheck";
import { makeVideoThumbs } from "@/lib/video/videoPoster";
import type { EditorOcr } from "./useEditorOcr";
import type { EditorRef, SetEditorError } from "./types";

// プレースホルダの一意性のための連番 (インスタンス間で共有してよい)
let uploadSeq = 0;

export interface InsertFilesOptions {
  // 音声の画像記法に入れる alt。録音は日時を残したいので上書きする
  // (ファイル選択・ペースト由来の音声は既定の "audio" のまま)
  audioAlt?: string;
  // 動画の alt。録画は日時を残したいので上書きする (ファイル選択・ペースト
  // 由来の動画は既定の "video" のまま)
  videoAlt?: string;
  // 画像の alt。お絵かきは「いつ描いたか」を残して全文検索から引けるようにする
  // (ファイル選択・ペースト由来の画像は既定の空のまま)
  imageAlt?: string;
  // 挿入した画像を続けて OCR するか。お絵かきは自分で描いたものなので読まない
  // (要るときは「後から OCR」ボタンで読ませられる)
  ocr?: boolean;
  // 上限を超えた画像を、断らずに縮めて送るか (docs/92-クリップボード連携計画.md §4)。
  // **クリップボード由来のときだけ true。** iOS は写真をコピーすると PNG で
  // 渡してくることが多く、12MP の写真はそれだけで 20〜30MB になる。OS が作り
  // 直した写しなので縮めて構わない。ファイル選択・ドロップは原本を指している
  // ので既定の false のまま (黙って再圧縮せず、上限を理由に断る)
  shrinkOversized?: boolean;
}

export type InsertFiles = (
  view: EditorView,
  files: File[],
  options?: InsertFilesOptions,
) => Promise<void>;

type ReportIgnored = (
  list: FileList | null | undefined,
  picked: File[],
) => void;

export interface AttachmentInsert {
  // 進行中アップロードの表示用スナップショット (何枚目 / 全何枚 / 送信 %)。
  // null なら待機中。busy 判定は従来の uploading boolean と同じ意味を保つ
  upload: UploadProgress | null;
  uploading: boolean;
  insertFiles: InsertFiles;
  // ペースト・ドロップで添付を拾う拡張。**参照は変わらない** (拡張一式に入る)
  fileEvents: Extension;
  fileInputRef: RefObject<HTMLInputElement | null>;
  openFilePicker: () => void;
  handleFilePick: (files: FileList | null) => void;
}

// アップロード済みの画像を Blob として取り直す。OCR は元 File ではなく
// これを読む: HEIC など Chrome/Firefox が createImageBitmap で復号できない
// 形式でも、保存時に WebP へ変換済みのバイトなら OCR・表示・検索が同じ画素を見る。
// 取得できなければ null (アップロードは成功しているので OCR だけ諦める)
async function fetchImageBlob(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

// 上限に収まるファイルを返す。超えていても、縮めてよい画像なら描き直して
// 小さくしたものを返す (docs/92-クリップボード連携計画.md §4)。縮められない
// もの・縮めても収まらないものは、従来どおり理由を添えて断る。
//
// **縮めた後にもう一度測る。** 上限を桁違いに超えた画像 (巨大な PNG) は、
// 長辺を落としても JPEG にしても収まらないことがありうる。そのまま送ると
// エッジが本文を捨てて「通信エラー」に化ける
async function fitToLimit(file: File, allowShrink: boolean): Promise<File> {
  const tooLarge = uploadTooLargeMessage(file, isVideoFile(file));
  if (tooLarge === null) {
    return file;
  }
  if (!allowShrink || !canShrink(file)) {
    throw new Error(tooLarge);
  }
  const shrunk = await shrinkImageFile(file);
  const stillTooLarge = uploadTooLargeMessage(shrunk, false);
  if (stillTooLarge !== null) {
    throw new Error(stillTooLarge);
  }
  return shrunk;
}

// ペースト/ドロップで添付を拾う CodeMirror の口。
//
// 拡張は編集画面につき一度しか組まない (useEditorExtensions) ので、ここで
// 掴む関数は**最新を ref から読む**。描画のたびに作り直される insertFiles を
// そのまま閉じ込めると、拡張を組んだ時点の関数を永久に使い続けることになる
// (かつては useMemo の依存から外して lint 警告 1 件を抱えていた)
function fileEventHandlers(
  handlersRef: Readonly<
    RefObject<{ insertFiles: InsertFiles; reportIgnored: ReportIgnored }>
  >,
): Extension {
  return EditorView.domEventHandlers({
    paste: (event, view) => {
      const { insertFiles, reportIgnored } = handlersRef.current;
      const files = pickFiles(event.clipboardData?.files);
      if (files.length === 0) {
        // ファイルを貼ったのに 1 つも拾えなかったときだけ知らせる
        // (文字列のペーストはここに来ても files が空なので何も出ない)
        reportIgnored(event.clipboardData?.files, files);
        return false;
      }
      event.preventDefault();
      // ペーストもクリップボード由来なので、上限を超えた画像は縮めて送る
      // (docs/92-クリップボード連携計画.md §4)。iOS の写真は PNG で来て
      // 20〜30MB になり、そのままでは必ず「大きすぎます」で止まる
      void insertFiles(view, files, { shrinkOversized: true });
      reportIgnored(event.clipboardData?.files, files);
      return true;
    },
    drop: (event, view) => {
      const { insertFiles, reportIgnored } = handlersRef.current;
      const files = pickFiles(event.dataTransfer?.files);
      if (files.length === 0) {
        reportIgnored(event.dataTransfer?.files, files);
        return false;
      }
      event.preventDefault();
      // ドロップした位置にカーソルを移してから挿入する
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos !== null) {
        view.dispatch({ selection: { anchor: pos } });
      }
      void insertFiles(view, files);
      reportIgnored(event.dataTransfer?.files, files);
      return true;
    },
  });
}

// 画像・音声・動画・PDF・テキストの挿入 (ファイル選択・ペースト・ドロップ・
// 録音・録画・お絵かき・クリップボードが全部ここを通る)。
// /api/images へアップロードし、カーソル位置に ![](url) を挿入する
export function useAttachmentInsert({
  editorRef,
  setError,
  ocrIntoDoc,
}: {
  editorRef: EditorRef;
  setError: SetEditorError;
  ocrIntoDoc: EditorOcr["ocrIntoDoc"];
}): AttachmentInsert {
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 拾わなかったファイルがあれば知らせる (理由は ignoredFilesMessage)
  const reportIgnored: ReportIgnored = (list, picked) => {
    const message = ignoredFilesMessage(list, picked);
    if (message !== null) {
      setError(message);
    }
  };

  // 1 つ分。失敗したらプレースホルダを消して投げ直す (残りは送らない)
  const insertOne = async (
    view: EditorView,
    file: File,
    position: { current: number; total: number },
    options: Required<InsertFilesOptions>,
  ) => {
    // **プレースホルダと busy を、待つより先に置く。** この後の
    // fitToLimit は縮小で数秒かかることがあり (20〜30MB の PNG)、その間に
    // 何も置かないと画面は待機中のままになる。busy でなければ「更新」も
    // 通ってしまい、画像の入っていない本文が保存されてから記法だけが
    // 後追いで挿さる形になる
    const token = `![アップロード中 ${++uploadSeq}]()`;
    insertText(view, token);
    // 送信が始まるまでは % を出さない (percent: null →「アップロード中…」)。
    // 動画では下のコマ抽出に数秒かかることがあり、0% に張り付いて見えるより
    // % 無しの方がましなため (progressLabels.ts の同旨の判断と揃える)
    setUpload({ ...position, percent: null });
    try {
      // 上限超えは**送る前に**断る。送ってしまうと、エッジ (nginx / Caddy) か
      // Next.js の proxy が本文を途中で捨て、ブラウザには「通信エラー」や
      // 見当違いの 400 しか返らない (理由は uploads/uploadSizeCheck.ts)。
      // ここで止めれば「何 MB のファイルが上限何 MB を超えた」まで言える。
      // クリップボード由来の画像だけは、断る前に縮めて送り直す (§4)
      const sending = await fitToLimit(file, options.shrinkOversized);
      // 動画は静止サムネ (poster) と動くサムネのコマをここで作り、本体と
      // 同じ POST で送る (41-QR-search/docs/14 §Phase3, docs/72-動画アニメサムネ計画.md)。
      // 作れなければ空 (サムネ無しで続行)。コマ集めには上限時間があり、
      // 間に合ったぶんだけが送られる (videoPoster.ts の ANIM_BUDGET_MS)
      const thumbs = shouldMakeThumbs(sending)
        ? await makeVideoThumbs(sending)
        : null;
      // 送信 % はボタンラベル (React state) だけに出す。本文トークンを
      // % で書き換えると undo が壊れる (ocrIntoDoc の同旨コメント参照)。
      // アップロードは直列なので、ボタンの % が常に今のファイルの %。
      // 画像・音声・動画とも同じ /api/images へ送る (サーバが中身で振り分ける)
      const url = await uploadImageWithProgress(
        sending,
        (percent) => {
          setUpload({ ...position, percent });
        },
        thumbs,
      );
      // 種類ごとの alt の決め方は attachmentAlt
      const kind = attachmentKind(url);
      const alt = attachmentAlt(kind, sending.name, {
        audio: options.audioAlt,
        video: options.videoAlt,
        image: options.imageAlt,
      });
      const markup = `![${alt}](${url})`;
      replaceToken(view, token, markup);
      if (kind !== "image" || !options.ocr) {
        return; // 画像でないもの・OCR を頼まれていないものは読まない
      }
      // 挿入した画像を OCR し、直後に引用ブロックを差し込む。
      // アップロードの流れは止めない (url は UUID で一意なので位置を引ける)。
      // OCR には元 File ではなく保存後の画像 (url) を読ませる。HEIC など
      // ブラウザが直接復号できない形式は、保存時に WebP へ変換済みのため
      const pos = view.state.doc.toString().indexOf(markup);
      if (pos >= 0) {
        void ocrIntoDoc(view, fetchImageBlob(url), pos + markup.length);
      }
    } catch (e) {
      replaceToken(view, token, "");
      throw e;
    }
  };

  const insertFiles: InsertFiles = async (view, files, options = {}) => {
    const resolved: Required<InsertFilesOptions> = {
      audioAlt: options.audioAlt ?? "audio",
      videoAlt: options.videoAlt ?? "video",
      imageAlt: options.imageAlt ?? "",
      ocr: options.ocr ?? true,
      shrinkOversized: options.shrinkOversized ?? false,
    };
    setError(null);
    try {
      for (const [index, file] of files.entries()) {
        await insertOne(
          view,
          file,
          { current: index + 1, total: files.length },
          resolved,
        );
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUpload(null);
    }
  };

  const handlersRef = useLatest({ insertFiles, reportIgnored });
  const fileEvents = useMemo(
    () => fileEventHandlers(handlersRef),
    [handlersRef],
  );

  const handleFilePick = (files: FileList | null) => {
    const view = editorRef.current?.view;
    const picked = pickFiles(files);
    if (view && picked.length > 0) {
      void insertFiles(view, picked);
    }
    reportIgnored(files, picked);
    // 同じファイルを続けて選べるようリセットする
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return {
    upload,
    uploading: upload !== null,
    insertFiles,
    fileEvents,
    fileInputRef,
    openFilePicker: () => fileInputRef.current?.click(),
    handleFilePick,
  };
}
