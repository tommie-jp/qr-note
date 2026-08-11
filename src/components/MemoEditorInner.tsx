"use client";

import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import "@atomic-editor/editor/styles.css";
// ライブプレビューの数式 (mathBlocks.ts) が KaTeX の組んだ HTML を出すので、
// 編集画面でもその CSS が要る。閲覧側 (MarkdownView) とは別の入り口なので
// ここでも読み込む — 無いと数式が素の文字列として崩れて出る
import "katex/dist/katex.min.css";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import dynamic from "next/dynamic";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useBottomBarSlot } from "@/components/BottomBarContext";
import { EditToolbar } from "@/components/EditToolbar";
import { PanelActiveContext } from "@/components/PanelActiveContext";
import {
  DemoDisabledError,
  fetchPrefillSummary,
  prefillTargetFromCode,
} from "@/lib/prefillSummary";
import { isTaggableCode, scanRegisterMemo } from "@/lib/scanRegister";
import { recordingAltText } from "@/lib/audio/audioRecorder";
import { AUDIO_EXTENSION_ALTERNATION } from "@/lib/audioFormats";
import { recordingAltText as videoRecordingAltText } from "@/lib/video/videoRecorder";
import { makeVideoThumbs } from "@/lib/video/videoPoster";
import { VIDEO_EXTENSION_ALTERNATION } from "@/lib/videoFormats";
import { TEXT_EXTENSION_ALTERNATION } from "@/lib/textFormats";
import { uploadTooLargeMessage } from "@/lib/uploadSizeCheck";
// 打ち止めと文字数表示は**サーバと同じ上限**を見る (別に持つと、編集画面が
// 止めているのにインポートは通る/その逆のずれ方をする)
import { MAX_TEXT_LENGTH } from "@/lib/validation";
import { imageAtCursor, ocrInsertion, ocrPlaceholder } from "@/lib/ocr/ocrQuote";
import {
  ocrButtonLabel,
  recordButtonLabel,
  uploadButtonLabel,
  type UploadProgress,
} from "@/lib/progressLabels";
import {
  findSecretNotation,
  secretAtCursor,
  secretNotation,
  secretToolbarLabel,
} from "@/lib/secrets";
import { fenceLanguageCompletion } from "./fenceCompletion";
import { fenceLanguageLinter } from "./fenceLinter";
import {
  createLivePreviewCompartment,
  livePreviewContent,
} from "./editor/livePreview";
import { formatSpec, type FormatAction } from "./editor/markdownFormat";
import { quizLinter } from "./editor/quizLinter";
import {
  LIVE_PREVIEW_DEFAULT,
  loadLivePreviewPref,
  saveLivePreviewPref,
} from "@/lib/livePreviewPref";
import {
  disposeOcr,
  isOcrReady,
  MODEL_READY_PERCENT,
  ocrImageToQuote,
  subscribeModelProgress,
} from "./ocr/ocrService";
import { uploadImageWithProgress } from "./uploadImageXhr";
import { BUSY_NOTICE_CLASS, BUSY_SPINNER_CLASS } from "./ui";
import { useAudioRecording } from "./useAudioRecording";
import { useVideoRecording } from "./useVideoRecording";
import { VideoRecordModal } from "./VideoRecordModal";

// fabric 一式は重いので、お絵かきを開くまで読み込まない
// (CodeMirror を遅延させているのと同じ流儀。MemoEditor.tsx 参照)
const DrawModal = dynamic(() => import("./draw/DrawModal"), {
  ssr: false,
  loading: () => null,
});

// スキャナ (カメラ + zxing wasm) も重いので、スキャンを押すまで読み込まない。
// 検索画面 (BottomActionBar) と同じ部品を、挿入モード (onResult) で使う
const ScannerModal = dynamic(
  () => import("./ScannerModal").then((m) => m.ScannerModal),
  { ssr: false, loading: () => null },
);

// シークレットの入力ダイアログ (docs/51-部分暗号化計画.md §8)。
// 開くまで読み込まない (暗号まわり一式を普段の編集に載せない)
const SecretDialog = dynamic(
  () => import("./secret/SecretDialog").then((m) => m.SecretDialog),
  { ssr: false, loading: () => null },
);

export interface MemoEditorInnerProps {
  value: string;
  onChange: (value: string) => void;
  onReady: () => void;
  autoFocus?: boolean;
  minHeight?: string;
}

// ファイル選択ダイアログの絞り込み。MIME に加えて拡張子も併記するのは、
// iOS/一部 OS が HEIC の MIME を空で送ることがあり、MIME だけだと選べないため。
// HEIC/HEIF・TIFF はサーバが保存時に WebP へ変換する (docs/26-画像形式対応計画.md)。
// 最終的な形式判定はサーバの sniffImageFormat が中身を見て行う
const ACCEPTED_IMAGE_TYPES =
  "image/png,image/jpeg,image/gif,image/webp,image/avif,image/heic,image/heif,image/tiff,.png,.jpg,.jpeg,.gif,.webp,.avif,.heic,.heif,.tif,.tiff";

// 音声 (docs/12-添付ファイル種類拡張メモ.md)。mp3/m4a/wav/webm を受け付ける。
// audio/x-m4a は一部ブラウザが m4a に付ける別名。webm はブラウザ内録音の
// 出力形式で、ファイル選択からも受ける。最終判定はサーバの
// sniffAudioFormat が中身を見て行う (音声トラックだけの webm しか通らない)
const ACCEPTED_AUDIO_TYPES =
  "audio/mpeg,audio/mp4,audio/wav,audio/x-m4a,audio/webm,.mp3,.m4a,.wav,.webm";

// 動画 (docs/14-動画挿入計画.md)。mp4/webm/mov を受け付ける。iOS カメラロールは
// .mov (QuickTime)、Android の録画は .webm。最終判定はサーバの sniffVideoFormat が
// 中身を見て行う (映像トラックを持つものだけが動画として通る)。webm 動画は
// 保存時に .mkv へ写す (videoFormats.ts の経緯) が、ここは**入力**の受け口なので
// ユーザーのファイル名 (.webm) と MIME を併記する
const ACCEPTED_VIDEO_TYPES =
  "video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov,.mkv,.3gp";

// PDF (docs/12-添付ファイル種類拡張メモ.md)。表示はブラウザ内蔵ビューアに任せ、
// 本文にはリンクだけを出す
const ACCEPTED_PDF_TYPES = "application/pdf,.pdf";

// テキスト系 (docs/12-添付ファイル種類拡張メモ.md)。**MIME も併記する** —
// iOS の file picker は accept の各項目を UTI に変換して照合し、`.md` には
// iOS 標準の UTI が無いため、拡張子だけだと Evernote 等から渡る .md が
// どれにも一致せずグレーアウトする。`text/plain` (= public.plain-text) を
// 足すと、plain-text 系として型付けされた .md が選べるようになる。
// これで拡張子なしのテキストも選べてしまうが、対象外は reportIgnored と
// サーバの拒否メッセージがちゃんと知らせるので無反応にはならない
const ACCEPTED_TEXT_TYPES = "text/plain,text/csv,text/markdown,.txt,.csv,.md";

const ACCEPTED_FILE_TYPES = `${ACCEPTED_IMAGE_TYPES},${ACCEPTED_AUDIO_TYPES},${ACCEPTED_VIDEO_TYPES},${ACCEPTED_PDF_TYPES},${ACCEPTED_TEXT_TYPES}`;

// ペースト/ドロップで拾う画像の判定。MIME が image/* のもの、または
// 対応拡張子を持つもの (MIME を空で送る HEIC 対策)。実体の検査はサーバが行う
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|avif|heic|heif|tiff?)$/i;

// 音声の判定。MIME が audio/* のもの、または対応拡張子を持つもの。
const AUDIO_EXT_RE = new RegExp(`\\.(?:${AUDIO_EXTENSION_ALTERNATION})$`, "i");

// 動画の入力判定。ペースト/ドロップ/ファイル選択で拾う。MIME が video/* の
// もの、または動画の入力拡張子。**保存名の拡張子 (VIDEO_EXTENSION_ALTERNATION =
// mp4|mkv|mov) とは別**で、こちらはユーザーが持つファイル名 (.webm 等) を拾う。
const VIDEO_INPUT_EXT_RE = /\.(?:mp4|m4v|webm|mov|mkv|3gp)$/i;

// 保存後の URL から動画と判る拡張子 (attachmentKind / 表示の振り分け用)。
// サーバが付ける保存名の拡張子 (mp4|mkv|mov)。
const VIDEO_URL_EXT_RE = new RegExp(
  `\\.(?:${VIDEO_EXTENSION_ALTERNATION})$`,
  "i",
);

const PDF_EXT_RE = /\.pdf$/i;

// テキストの判定は**拡張子だけ**で行う。音声や PDF と違って MIME で広めに
// 拾わないのは、サーバが受ける条件がまさに「名前が txt/csv/md であること」
// だから (uploads.ts textSaveInfo)。ここで広く拾うと、選べたのに 400 で
// 断られるものが出てしまう
const TEXT_EXT_RE = new RegExp(`\\.(?:${TEXT_EXTENSION_ALTERNATION})$`, "i");

function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/") || AUDIO_EXT_RE.test(file.name);
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || VIDEO_INPUT_EXT_RE.test(file.name);
}

// サムネ (静止 poster + 動くサムネのコマ) を作りに行くか。**MIME が video/* の
// ときだけ**にする — .webm は音声と拡張子を共有するので、名前だけで判ると音声
// webm でも 5 秒待って空フレームを作る無駄が出る。録画・実際の動画ファイルは
// video/* が付く。
function shouldMakeThumbs(file: File): boolean {
  return file.type.startsWith("video/");
}

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || PDF_EXT_RE.test(file.name);
}

function isTextFile(file: File): boolean {
  return TEXT_EXT_RE.test(file.name);
}

// PDF・テキストは元のファイル名を画像記法の alt に残す。UUID 名では中身が
// 判らないうえ、本文に入れておけば PGroonga の全文検索でファイル名から引ける。
// `]` と改行は画像記法そのものを壊すので落とす (URL 側はサーバ発番の UUID)。
function attachmentAltText(fileName: string, fallback: string): string {
  const cleaned = fileName.replace(/[[\]\r\n]/g, "").trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

type AttachmentKind = "image" | "audio" | "video" | "pdf" | "text";

// 保存された添付の種類を**保存後の URL の拡張子**から決める。
//
// 元 File の MIME や名前では決めない。何として保存するかを決めるのは中身を見た
// サーバで、クライアントの申告ではないため (拡張子を偽装したファイルはここで
// 食い違う)。MarkdownView も同じく URL の拡張子で描き分けるので、
// **本文に書く記法と表示の振り分けが必ず一致する**
function attachmentKind(url: string): AttachmentKind {
  if (AUDIO_EXT_RE.test(url)) {
    return "audio";
  }
  // 保存名の拡張子 (mp4|mkv|mov)。音声の .webm とは重ならない (VideoFormat の
  // webm 動画は .mkv で保存される)
  if (VIDEO_URL_EXT_RE.test(url)) {
    return "video";
  }
  if (PDF_EXT_RE.test(url)) {
    return "pdf";
  }
  if (TEXT_EXT_RE.test(url)) {
    return "text";
  }
  return "image";
}

// alt が空になったときの表示名 (MarkdownView の既定ラベルと揃える)
const KIND_FALLBACK: Record<"pdf" | "text", string> = {
  pdf: "PDF",
  text: "テキスト",
};

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

function insertText(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
}

// アップロード中に本文が編集されても正しい場所を差し替えられるよう、
// 位置ではなく一意なプレースホルダ文字列を検索して置換する
function replaceToken(view: EditorView, token: string, replacement: string): void {
  const pos = view.state.doc.toString().indexOf(token);
  if (pos < 0) {
    return; // ユーザーがプレースホルダを消した場合は何もしない
  }
  view.dispatch({
    changes: { from: pos, to: pos + token.length, insert: replacement },
  });
}

// アップロード対象に拾うファイル (画像・音声・動画・PDF・テキスト)。
function pickFiles(list: FileList | undefined | null): File[] {
  return Array.from(list ?? []).filter(
    (f) =>
      f.type.startsWith("image/") ||
      IMAGE_EXT_RE.test(f.name) ||
      isAudioFile(f) ||
      isVideoFile(f) ||
      isPdfFile(f) ||
      isTextFile(f),
  );
}

// 処理中にフォーム送信を止めたときに出す理由。**録音を先に見る** —
// アップロードや OCR は画面に進捗が出ているが、録音は押しっぱなしのまま
// 更新しようとすることがあり、そのまま通すと録音ごと失うため
function busyReason(
  isRecording: boolean,
  uploading: boolean,
  scanBusy: boolean,
): string {
  if (isRecording) {
    return "録音・録画中です。停止してから更新して下さい。";
  }
  if (uploading) {
    return "画像のアップロード中です。完了してから更新して下さい。";
  }
  if (scanBusy) {
    return "コード情報の取得中です。完了してから更新して下さい。";
  }
  return "OCR 処理中です。完了してから更新して下さい。";
}

// CodeMirror に渡す設定はレンダリングごとに作り直さない。
// @uiw/react-codemirror は basicSetup / onUpdate の**参照**が変わるたびに
// StateEffect.reconfigure で拡張一式を組み直すため、毎回新しいオブジェクトを
// 渡すと打鍵のたびに全部が再構成される。録音中は 1 秒ごとに再レンダリングが
// 走るので、そのままだと再構成もその回数だけ起きる
const BASIC_SETUP = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
} as const;

// プレースホルダの一意性のための連番 (インスタンス間で共有してよい)
let uploadSeq = 0;
let ocrSeq = 0;

// ライブプレビューの設定の読み書き (docs/70-編集ライブプレビュー計画.md §4)。
// **window.localStorage を触ること自体が例外になる**ブラウザがある
// (Cookie を全面禁止した Chrome など)。判定・整形は lib 側の純関数が持ち、
// ここは「触れない環境でも編集は従来どおりできる」ための包みだけを足す
function readLivePreviewPref(): boolean {
  try {
    return loadLivePreviewPref(window.localStorage);
  } catch {
    return LIVE_PREVIEW_DEFAULT;
  }
}

function writeLivePreviewPref(enabled: boolean): void {
  try {
    saveLivePreviewPref(window.localStorage, enabled);
  } catch {
    // 覚えられなくても、その場の切り替えは効いている
  }
}

interface InsertFilesOptions {
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
}

// markdown 用 CodeMirror エディタ本体 (制御コンポーネント)。
// 画像はペースト / ドラッグ&ドロップ / 画像ボタンで /api/images へアップロードし、
// カーソル位置に ![](url) を挿入する
export default function MemoEditorInner({
  value,
  onChange,
  onReady,
  autoFocus = false,
  minHeight = "14rem",
}: MemoEditorInnerProps) {
  // 進行中アップロードの表示用スナップショット (何枚目 / 全何枚 / 送信 %)。
  // null なら待機中。busy 判定は従来の uploading boolean と同じ意味を保つ
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const uploading = upload !== null;
  // 実行中の OCR の本数 (複数画像を続けて OCR できる)。0 より大きい間は
  // 「OCR処理中」を出し、フォーム送信を止める (結果が本文に入る前に更新しない)。
  const [ocrCount, setOcrCount] = useState(0);
  // 初回のモデルダウンロードの実測 % (完了・待機中は null)
  const [modelPercent, setModelPercent] = useState<number | null>(null);
  // OCR の情報表示 (エラーではない「準備中」「見つかりませんでした」など)。
  // 初回はモデル取得で待ちが長く、灰色だと埋もれて「固まった」と誤解される
  // ため、画像検索の準備中バナーと同じ赤背景で目立たせる (ImageSearchModal)。
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // undo / redo ボタンの活殺 (docs/11-アプリ的UIUX計画.md §2-4)。
  // 履歴自体は basicSetup が既定で持っている (Ctrl+Z も従来どおり効く)
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  // お絵かき画面。null なら閉じている。開くときにカーソルの近くの画像を控え、
  // 下敷きの候補として渡す (docs/34-お絵かき計画.md §2)
  const [drawing, setDrawing] = useState<{ sourceImageUrl: string | null } | null>(
    null,
  );
  // 編集中スキャン (docs/13/14 の書誌・商品情報を挿入する導線)。
  // scanning … カメラのモーダルを開いているか。scanBusy … 読み取り後の取得中
  // (フォーム送信を止める)。scanNote … 取得中・結果の知らせ (OCR と同じ赤バナー)
  const [scanning, setScanning] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  // シークレットの入力ダイアログ (docs/51-部分暗号化計画.md §8)。null なら閉じている。
  // name が非 null なら既存の断片の編集、null なら新規 (text は選択範囲)
  const [secret, setSecret] = useState<{
    name: string | null;
    text: string;
    label: string;
  } | null>(null);
  // ツールバーに出す文字。カーソルが記法の上なら「秘密を編集」に変わる
  // (docs/52 §1)。押した先の分岐は openSecret が持つので、これは見た目だけ
  const [secretLabel, setSecretLabel] = useState("秘密");
  // ライブプレビュー (docs/70-編集ライブプレビュー計画.md)。記法を隠して
  // 装飾済みに見せる表示で、**本文は書き換えない**。OFF は従来の編集表示。
  // この部品は ssr: false で読み込まれる (MemoEditor.tsx) ので、初期値を
  // localStorage から同期に読んでも hydration はずれない
  const [livePreview, setLivePreview] = useState(readLivePreviewPref);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // タブパネル (MemoPanel) が hidden で保持する構成では、非表示タブでも
  // このコンポーネントはマウントされたまま。portal は hidden の枠を抜けて
  // 下部バーに残るので、表向きのタブのときだけ portal する (既定 true =
  // MemoPanel を通らない /edit ページでは常に表示扱い)
  const panelActive = useContext(PanelActiveContext);
  // 編集ボタンは下部バー (PageBottomBar) の差し込み口へ portal する。
  // portal は React ツリーの親子を保つので、囲みの <form> の子孫のまま —
  // useFormStatus (更新ボタン) が効き、onClick から下の state/ref も触れる。
  //
  // 帯は差し込む側がいるときだけ出るので、まず要ると申告する
  // (useBottomBarSlot)。口 (hostEl) が返るのは帯が描かれた次の描画から
  const hostEl = useBottomBarSlot(panelActive);

  useEffect(() => {
    onReady();
    // マウント時に一度だけ通知する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // モデルダウンロードの % をバナーに流す。100 (初期化完了) でクリアする
  useEffect(() => {
    return subscribeModelProgress((percent) => {
      setModelPercent(percent >= MODEL_READY_PERCENT ? null : percent);
    });
  }, []);

  // 編集画面を離れたら OCR の Worker を落とす。抱えたままだと OpenCV と
  // onnxruntime の wasm ヒープが残り、後から開いた画像検索がモデルを積めずに
  // 落ちる (iOS WebKit のタブ上限)。terminate は realm ごと捨てるので
  // メモリが OS へ返る (ocrService.disposeOcr)
  useEffect(() => {
    return () => {
      disposeOcr("編集画面を離脱");
    };
  }, []);

  // 編集画面からのその場録音 (docs/12「ノート内録音の実装計画」)。
  // 録音できたものは、ファイル選択と同じ挿入経路 (insertFiles) に流す。
  // alt には録音日時を残す (PDF のファイル名と同じ狙いで、全文検索から引ける)
  const recording = useAudioRecording({
    onFinish: async (result) => {
      const view = editorRef.current?.view;
      if (!view) {
        return;
      }
      await insertFiles(view, [result.file], {
        audioAlt: recordingAltText(result.recordedAt),
      });
    },
    onError: setError,
  });

  // 編集画面からのその場録画 (docs/14-動画挿入計画.md)。録音と同じく、録れた
  // ものはファイル選択と同じ挿入経路 (insertFiles) に流す。alt には録画日時を残す
  const videoRecording = useVideoRecording({
    onFinish: async (result) => {
      const view = editorRef.current?.view;
      if (!view) {
        return;
      }
      await insertFiles(view, [result.file], {
        videoAlt: videoRecordingAltText(result.recordedAt),
      });
    },
    onError: setError,
  });

  // アップロード / OCR / 録音・録画の完了前に送信すると、画像リンクや OCR 結果、
  // 録音・録画そのものが memo に入らないため、処理中だけフォーム送信をブロックして知らせる
  const isRecording = recording.isRecording || videoRecording.isRecording;
  const busy = uploading || ocrCount > 0 || isRecording || scanBusy;
  useEffect(() => {
    if (!busy) {
      return;
    }
    const form = wrapperRef.current?.closest("form");
    if (!form) {
      return;
    }
    const blockSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      setError(busyReason(isRecording, uploading, scanBusy));
    };
    form.addEventListener("submit", blockSubmit);
    return () => form.removeEventListener("submit", blockSubmit);
  }, [busy, uploading, isRecording, scanBusy]);

  // 画像 1 枚を OCR し、指定位置へ引用ブロックを差し込む。挿入時 OCR と
  // 「後から OCR」ボタンの両方がこの 1 本を使う (docs/24-画像OCR計画.md §4)。
  // 処理中はプレースホルダを置き、本文が編集されても文字列一致で差し替える。
  const ocrIntoDoc = async (
    view: EditorView,
    // Blob を直接、または後から届く Promise で受ける。プレースホルダは
    // insertPos が新鮮なうちに同期で挿し、画像取得の await はその後に回す
    // (取得を待つ間に本文が動いても、置換は文字列一致なのでずれない)
    source: Blob | Promise<Blob | null>,
    insertPos: number,
  ) => {
    const seq = ++ocrSeq;
    const placeholder = ocrPlaceholder(seq);
    const insertion = ocrInsertion(placeholder);
    view.dispatch({ changes: { from: insertPos, insert: insertion } });
    setOcrCount((n) => n + 1);
    // モデルが載っていなければ読み込みが走る。処理中との区別を出す。
    // 「初回のみ」とは言えない: 画面を離れるとモデルを解放する (disposeOcr) ので、
    // 戻ってきた 2 回目以降もここを通る
    setOcrNote(isOcrReady() ? null : "OCR モデルを準備しています…");
    try {
      const blob = source instanceof Blob ? source : await source;
      if (!blob) {
        // 画像を取り直せなかった。OCR はおまけなので黙って諦める
        // (アップロードは成功していて画像自体は本文に載っている)
        replaceToken(view, insertion, "");
        setOcrNote(null);
        return;
      }
      const quote = await ocrImageToQuote(blob);
      if (quote) {
        replaceToken(view, placeholder, quote);
        setOcrNote(null);
      } else {
        // 0 文字は黙って消さない。プレースホルダごと除いて理由を出す
        replaceToken(view, insertion, "");
        setOcrNote("画像から文字が見つかりませんでした。");
      }
    } catch (e) {
      replaceToken(view, insertion, "");
      setError(e instanceof Error ? e.message : String(e));
      // 「準備しています…」を畳む。残すとエラーと並んで
      // 「まだ待てば直る」と誤解される (実機で確認)
      setOcrNote(null);
    } finally {
      setOcrCount((n) => n - 1);
    }
  };

  // 拾わなかったファイルがあれば知らせる。
  //
  // pickFiles は対応外を黙って捨てるので、**何も起きない**状態になる。
  // 「選んだのに入らない」はエラーですらないぶん原因を探しようがなく、
  // 対応形式が増えるほど踏みやすい (.json や .log はテキストに見える)
  const reportIgnored = (list: FileList | null | undefined, picked: File[]) => {
    const ignored = Array.from(list ?? []).filter((f) => !picked.includes(f));
    if (ignored.length === 0) {
      return;
    }
    setError(
      `対応していない形式のため挿入しませんでした: ${ignored
        .map((f) => f.name)
        .join("、")}`,
    );
  };

  const insertFiles = async (
    view: EditorView,
    files: File[],
    options: InsertFilesOptions = {},
  ) => {
    const { audioAlt = "audio", videoAlt = "video", imageAlt = "", ocr = true } =
      options;
    setError(null);
    try {
      for (const [index, file] of files.entries()) {
        // 上限超えは**送る前に**断る。送ってしまうと、エッジ (nginx / Caddy) か
        // Next.js の proxy が本文を途中で捨て、ブラウザには「通信エラー」や
        // 見当違いの 400 しか返らない (理由は uploadSizeCheck.ts)。
        // ここで止めれば「何 MB のファイルが上限何 MB を超えた」まで言える
        const tooLarge = uploadTooLargeMessage(file, isVideoFile(file));
        if (tooLarge) {
          throw new Error(tooLarge);
        }
        const token = `![アップロード中 ${++uploadSeq}]()`;
        insertText(view, token);
        // 送信が始まるまでは % を出さない (percent: null →「アップロード中…」)。
        // 動画では下のコマ抽出に数秒かかることがあり、0% に張り付いて見えるより
        // % 無しの方がましなため (progressLabels.ts の同旨の判断と揃える)
        setUpload({ current: index + 1, total: files.length, percent: null });
        try {
          // 動画は静止サムネ (poster) と動くサムネのコマをここで作り、本体と
          // 同じ POST で送る (docs/14 §Phase3, docs/72-動画アニメサムネ計画.md)。
          // 作れなければ空 (サムネ無しで続行)。コマ集めには上限時間があり、
          // 間に合ったぶんだけが送られる (videoPoster.ts の ANIM_BUDGET_MS)
          const thumbs = shouldMakeThumbs(file)
            ? await makeVideoThumbs(file)
            : null;
          // 送信 % はボタンラベル (React state) だけに出す。本文トークンを
          // % で書き換えると undo が壊れる (ocrIntoDoc の同旨コメント参照)。
          // アップロードは直列なので、ボタンの % が常に今のファイルの %。
          // 画像・音声・動画とも同じ /api/images へ送る (サーバが中身で振り分ける)
          const url = await uploadImageWithProgress(
            file,
            (percent) => {
              setUpload({ current: index + 1, total: files.length, percent });
            },
            thumbs,
          );
          // 音声は ![audio](url)、動画は ![video](url)、PDF・テキストは
          // ![ファイル名.pdf](url) で挿入し、MarkdownView が src の拡張子を見て
          // <audio> / <video> / ビューアに振り分ける。画像は従来どおり ![](url)
          const kind = attachmentKind(url);
          const alt =
            kind === "audio"
              ? audioAlt
              : kind === "video"
                ? videoAlt
                : kind === "image"
                  ? imageAlt
                  : attachmentAltText(file.name, KIND_FALLBACK[kind]);
          const markup = `![${alt}](${url})`;
          replaceToken(view, token, markup);
          if (kind !== "image" || !ocr) {
            continue; // 画像でないもの・OCR を頼まれていないものは読まない
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
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpload(null);
    }
  };

  // 拡張一式と、ライブプレビューの差し替え口を**一緒に**組む。
  // Compartment をここで作るのは、拡張と寿命を揃えるため — 外で作って
  // 配列の中から参照すると、拡張を組む useMemo の依存に載ってしまう
  // (載せれば切り替えのたびに全再構成、載せなければ lint が鳴る)
  const { extensions, livePreviewCompartment } = useMemo(() => {
    const livePreviewCompartment = createLivePreviewCompartment();
    // markdown() は内部で新しい言語インスタンスを作ってそこに組み込み補完を
    // 登録する。export される markdownLanguage は別インスタンスのため、
    // そちらに登録しても効かない (バンドル環境で languageDataAt に載らない)。
    // markdown() が返した当のインスタンス (md.language) に登録する。
    //
    // **base に markdownLanguage を渡して GFM を有効にする。**
    // 既定の base は CommonMark だけで、`- [ ] ` も `~~消し~~` も表 も
    // 構文木に出ない (TaskMarker / Strikethrough / Table のノードが無い)。
    // 本文の描画は remark-gfm で GFM として解釈している (markdownPipeline)
    // ので、エディタ側だけ CommonMark だと食い違う。
    //
    // これに気づいたのはライブプレビュー (docs/70) の実機確認 —
    // チェックボックスがウィジェットにならず、原因が構文木側だった。
    // 見えるところでは「装飾が付かない」形でしか出ないので気づきにくい
    const md = markdown({ base: markdownLanguage });
    const extensions = [
      md,
      // ```<言語> の補完 (basicSetup が autocompletion を既定で有効化済み)。
      // override せず language data 経由で登録し、組み込み補完と共存させる
      md.language.data.of({ autocomplete: fenceLanguageCompletion }),
      // circuitikz / mermaid の打ち間違いに警告を出す (補完だけでは
      // 入れ替わり誤字が無反応で確定してしまうため)
      fenceLanguageLinter,
      // ```quiz の中身の書き方 (docs/58 §2)。間違いに気づく場所が
      // 閲覧タブまで遠いので、編集中にその場で知らせる
      quizLinter,
      EditorView.lineWrapping,
      // 旧 textarea の maxLength 相当: 上限を超える変更を受け付けない
      EditorState.changeFilter.of((tr) => tr.newDoc.length <= MAX_TEXT_LENGTH),
      // ライブプレビューの差し込み口。中身の入れ替えは reconfigure で行い、
      // この配列の**参照は変えない** (参照が変わると拡張一式が組み直される)。
      //
      // **覚えてある設定はここで読む。** かつては常に OFF で組んでおいて
      // マウント時の effect で入れ直していたが、それでは効かなかった —
      // その時点では @uiw/react-codemirror がまだ view を作っておらず
      // (editorRef.current?.view が undefined)、dispatch が黙って捨てられる。
      // ボタンは ON の見た目なのに装飾が出ない、という形で出た (実機で確認)。
      // 拡張を組むこの場で読めば view の有無に関係なく最初から載り、
      // 一瞬だけ生記法が見える瞬間も無くなる。
      //
      // 描画中に localStorage を読むことになるが、この部品は ssr: false で
      // 読み込まれる (MemoEditor.tsx) ので hydration はずれない
      livePreviewCompartment.of(livePreviewContent(readLivePreviewPref())),
      EditorView.domEventHandlers({
        paste: (event, view) => {
          const files = pickFiles(event.clipboardData?.files);
          if (files.length === 0) {
            // ファイルを貼ったのに 1 つも拾えなかったときだけ知らせる
            // (文字列のペーストはここに来ても files が空なので何も出ない)
            reportIgnored(event.clipboardData?.files, files);
            return false;
          }
          event.preventDefault();
          void insertFiles(view, files);
          reportIgnored(event.clipboardData?.files, files);
          return true;
        },
        drop: (event, view) => {
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
      }),
    ];
    return { extensions, livePreviewCompartment };
    // insertImages は ref と state セッターのみ参照するため再生成不要
  }, []);

  // 書式メニューで選んだ記法を選択範囲へ掛ける (docs/70 §6)。
  // 何を変えるかは markdownFormat が決め、ここは反映と後始末だけ。
  // **focus を戻す**のが要点 — メニューのボタンを押した時点でエディタは
  // フォーカスを失っており、戻さないと続けて打てない (選択も見えなくなる)
  const applyFormat = (action: FormatAction) => {
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    view.dispatch(formatSpec(view.state, action));
    view.focus();
  };

  // ＋ で新しいページを足す (docs/74-ページ計画.md §5)。
  //
  // **区切り行を 1 つ挿すだけ**。本文は 1 枚のままなので、undo 履歴も
  // ライブプレビューもツールバーも今までどおり動く (ページごとに value を
  // 差し替える作りにしない理由は計画 §5)。
  //
  // notePages は remark を引き込むので、押すまで読み込まない (お絵かき・
  // スキャナと同じ流儀)。本文は **await の後に**読み直す — 読み込みを待つ
  // 間に打鍵が続いても、位置が古い本文のままにならないように
  const addPage = async () => {
    const { newPageInsertion } = await import("@/components/notePages");
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    const { from, to, insert, cursor } = newPageInsertion(
      view.state.doc.toString(),
      view.state.selection.main.head,
    );
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: cursor },
      scrollIntoView: true,
    });
    view.focus();
  };

  // ライブプレビューの ON/OFF。Compartment の中身だけを入れ替えるので、
  // 拡張一式の組み直しも本文への書き込みも起きない (履歴に 1 手も積まれない)
  const toggleLivePreview = () => {
    const next = !livePreview;
    setLivePreview(next);
    writeLivePreviewPref(next);
    const view = editorRef.current?.view;
    if (view) {
      view.dispatch({
        effects: livePreviewCompartment.reconfigure(livePreviewContent(next)),
      });
    }
  };

  // undo / redo をボタンから呼ぶ。モバイルには Ctrl+Z がないため
  const runHistoryCommand = (command: (view: EditorView) => boolean) => {
    const view = editorRef.current?.view;
    if (view) {
      command(view);
      view.focus();
    }
  };

  // 「後から OCR」: カーソル位置にいちばん近い自前画像を取り直して OCR する。
  // 既にある画像 (過去にアップロード済み) を後から検索対象にできる (docs/24 §4)。
  const runOcrAtCursor = async () => {
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    setError(null);
    setOcrNote(null);
    const doc = view.state.doc.toString();
    const hit = imageAtCursor(doc, view.state.selection.main.head);
    if (!hit) {
      setOcrNote(
        "カーソルの近くに画像が見つかりません。画像の上を選んでから押して下さい。",
      );
      return;
    }
    try {
      const res = await fetch(hit.url);
      if (!res.ok) {
        throw new Error(`画像を取得できませんでした (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      await ocrIntoDoc(view, blob, hit.insertAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // 「お絵かき」: カーソルの近くに自前画像があればそれを下敷きにして開く。
  // 「後から OCR」と同じ探し方 (imageAtCursor) なので、画像の上で押せば
  // その画像に描ける。下敷きが要らなければお絵かき画面で白紙に切り替えられる
  const openDrawing = () => {
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    setError(null);
    const hit = imageAtCursor(
      view.state.doc.toString(),
      view.state.selection.main.head,
    );
    setDrawing({ sourceImageUrl: hit?.url ?? null });
  };

  // 描いたものは 1 枚の画像として、ファイル選択と同じ挿入経路に流す。
  // 元にした画像は書き換えない (描いたものは別の画像として増える)
  const insertDrawing = (file: File, alt: string) => {
    setDrawing(null);
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    view.focus();
    void insertFiles(view, [file], { imageAlt: alt, ocr: false });
  };

  // 履歴の深さが変わったときだけボタンの活殺を更新する。
  // onUpdate はカーソル移動でも呼ばれるので、同じ値なら前の state を
  // 返して再レンダリングを止める。
  // **参照を固定する** — CodeMirror はこの関数の参照が変わると拡張一式を
  // 組み直す (BASIC_SETUP のコメント参照)
  const handleUpdate = useCallback((update: ViewUpdate) => {
    const next = {
      canUndo: undoDepth(update.state) > 0,
      canRedo: redoDepth(update.state) > 0,
    };
    setHistory((prev) =>
      prev.canUndo === next.canUndo && prev.canRedo === next.canRedo
        ? prev
        : next,
    );

    // シークレットのボタン文字 (docs/52-シークレット編集導線計画.md §1)。
    // **本文かカーソルが動いたときだけ**数える。onUpdate は再描画や
    // フォーカスでも呼ばれるので、そのたびに全文を走査する必要はない。
    // 履歴と同じく、変わったときだけ setState して再レンダリングを止める
    if (update.docChanged || update.selectionSet) {
      const label = secretToolbarLabel(
        update.state.doc.toString(),
        update.state.selection.main.from,
      );
      setSecretLabel((prev) => (prev === label ? prev : label));
    }
  }, []);

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

  // 「更新」は下部バーへ portal されており、DOM は form の外に出る。native の
  // submit ボタンの関連付けは効かないので、囲みの form を明示的に送信する。
  // form は編集エリア (wrapperRef) から辿る — こちらは form の DOM 内にある
  const submitForm = () => {
    wrapperRef.current?.closest("form")?.requestSubmit();
  };

  // シークレット (docs/51-部分暗号化計画.md §8, §12)。
  //
  // カーソルがシークレット記法の上なら**その断片を開く** (編集)。そうでなければ
  // **選択範囲を引き継いで新規**にする — これが既存平文の移行導線そのもので、
  // 選んだ範囲がそのまま暗号化され、記法に置き換わる。
  //
  // 平文がここから memo の state へ入ることはない。ダイアログは自分の中だけで
  // 文字を持ち、封をしてから戻ってくる (記法だけが本文に入る)。
  const openSecret = () => {
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    const { from, to } = view.state.selection.main;
    const hit = secretAtCursor(view.state.doc.toString(), from);
    setSecret(
      hit
        ? { name: hit.name, text: "", label: hit.label }
        : { name: null, text: view.state.doc.sliceString(from, to), label: "" },
    );
  };

  // 封が済んだ断片を本文へ反映する。
  //
  // 新規は選択範囲を記法で置き換え、編集は**名前で引き直した位置**の記法を
  // 差し替える (ラベルを変えたときのため)。位置ではなく名前で引くので、
  // ダイアログを開いている間に本文が動いていても正しい場所に当たる。
  const applySecret = (name: string, label: string) => {
    const editing = secret !== null && secret.name !== null;
    setSecret(null);
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    const notation = secretNotation(label, name);

    if (!editing) {
      insertText(view, notation);
      return;
    }

    const hit = findSecretNotation(view.state.doc.toString(), name);
    if (hit) {
      view.dispatch({ changes: { from: hit.from, to: hit.to, insert: notation } });
    } else {
      // 利用者が記法ごと消していた。中身は保存済みなので、参照を入れ直す
      insertText(view, notation);
    }
    view.focus();
  };

  // カーソル位置へ 1 ブロックとして差し込む。前が改行でなければ改行で始め、
  // 末尾にも改行を足して、周りの本文と行が混ざらないようにする
  const insertBlock = (view: EditorView, text: string) => {
    const { from } = view.state.selection.main;
    const prevChar = from > 0 ? view.state.doc.sliceString(from - 1, from) : "\n";
    const prefix = prevChar === "\n" ? "" : "\n";
    insertText(view, `${prefix}${text}\n`);
  };

  // 編集中スキャン: バーコードを読んで書籍・商品情報をカーソル位置へ挿入する
  // (検索・遷移はしない。ユーザー要望)。ISBN→書誌、JAN→商品情報を引き、
  // 取れれば scanRegisterMemo で見出し+タグを、取れなくてもタグだけを挿す。
  // 書籍・商品コードでなければ、タグにできれば #コード、無理なら生値を入れる。
  const runScanInsert = async (rawValue: string) => {
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    const code = rawValue.trim();
    setError(null);
    setScanNote(null);
    view.focus();

    const target = prefillTargetFromCode(code);
    if (!target) {
      // 書籍・商品として引けないコード。タグにできれば #コード、それ以外は生値
      insertBlock(view, isTaggableCode(code) ? scanRegisterMemo(code).trim() : code);
      return;
    }

    const noun = target.kind === "book" ? "書籍情報" : "商品情報";
    setScanBusy(true);
    setScanNote(`${noun}を取得中…`);
    try {
      const summary = await fetchPrefillSummary(target);
      // 取れても取れなくてもコード自体は入れる (見つからなくても手掛かりが残る)
      insertBlock(view, scanRegisterMemo(code, summary).trim());
      setScanNote(
        summary ? null : `${noun}が見つかりませんでした。コードだけ挿入しました。`,
      );
    } catch (e) {
      // 取得に失敗してもコード (タグ) だけは入れておく
      insertBlock(view, scanRegisterMemo(code).trim());
      setScanNote(
        e instanceof DemoDisabledError
          ? `デモ版では${noun}を取得できません。コードだけ挿入しました。`
          : `${noun}の取得に失敗しました。コードだけ挿入しました。`,
      );
    } finally {
      setScanBusy(false);
    }
  };

  return (
    <div ref={wrapperRef} className="space-y-2">
      <div className="overflow-hidden rounded border border-gray-300 bg-white">
        <CodeMirror
          ref={editorRef}
          value={value}
          onChange={onChange}
          extensions={extensions}
          autoFocus={autoFocus}
          minHeight={minHeight}
          placeholder="メモを入力して下さい。"
          basicSetup={BASIC_SETUP}
          onUpdate={handleUpdate}
        />
      </div>
      {/* 操作ボタンは下部バーへ portal した (EditToolbar)。エディタ直下には
          文字数と補足だけを残す — バナー類 (エラー・録音/録画/OCR の知らせ) も
          打鍵中に見える本文の近くに置く */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {/* ペースト・ドラッグ&ドロップは実質デスクトップの操作なので、
            幅が狭いときは畳む */}
        <span className="hidden text-gray-400 sm:inline">
          画像・音声・動画・PDF はペースト・ドラッグ&ドロップでも挿入できます
        </span>
        <span
          className={`ml-auto ${
            value.length >= MAX_TEXT_LENGTH
              ? "font-bold text-red-600"
              : "text-gray-400"
          }`}
        >
          {value.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()}
        </span>
      </div>
      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {/* 自動停止の知らせ。押していないのに止まった理由が判らないと、
          録音が切れた原因を探せない */}
      {recording.note && (
        <p aria-live="polite" className={BUSY_NOTICE_CLASS}>
          {recording.note}
        </p>
      )}
      {/* 録画は全画面モーダルで行う (プレビュー・録画・カメラ操作すべて)。
          state と操作は videoRecording が持ち、ここは開閉のきっかけだけ */}
      <VideoRecordModal video={videoRecording} />
      {videoRecording.note && (
        <p aria-live="polite" className={BUSY_NOTICE_CLASS}>
          {videoRecording.note}
        </p>
      )}
      {ocrNote && (
        <p
          aria-live="polite"
          aria-busy={ocrCount > 0}
          className={`${BUSY_NOTICE_CLASS} flex items-center gap-2`}
        >
          {ocrCount > 0 && <span aria-hidden className={BUSY_SPINNER_CLASS} />}
          {ocrNote}
          {/* % は aria-hidden で足す: aria-live が毎ティック読み上げないように */}
          {modelPercent !== null && <span aria-hidden> {modelPercent}%</span>}
        </p>
      )}
      {/* 編集中スキャンの取得中・結果 (OCR と同じ赤バナー) */}
      {scanNote && (
        <p
          aria-live="polite"
          aria-busy={scanBusy}
          className={`${BUSY_NOTICE_CLASS} flex items-center gap-2`}
        >
          {scanBusy && <span aria-hidden className={BUSY_SPINNER_CLASS} />}
          {scanNote}
        </p>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        multiple
        hidden
        onChange={(e) => handleFilePick(e.target.files)}
      />
      {drawing && (
        <DrawModal
          sourceImageUrl={drawing.sourceImageUrl}
          onCancel={() => setDrawing(null)}
          onInsert={insertDrawing}
        />
      )}
      {/* シークレットの入力。**本文の state を経由しない** — ここで書いた
          平文は封をしてからでないと外へ出ない (docs/51 §8) */}
      {secret && (
        <SecretDialog
          name={secret.name}
          initialText={secret.text}
          initialLabel={secret.label}
          onSaved={applySecret}
          onClose={() => setSecret(null)}
        />
      )}
      {/* 編集中スキャン: 読み取った生値を runScanInsert へ渡すだけ (検索しない) */}
      {scanning && (
        <ScannerModal
          title="書籍・商品バーコードをかざす"
          onClose={() => setScanning(false)}
          onResult={(rawValue) => void runScanInsert(rawValue)}
        />
      )}
      {/* 操作ボタンを下部バーの差し込み口へ portal する。差し込み口が出来る
          まで hostEl は null (表向きのタブでない間も null)。portal は React
          ツリーの親子を保つので、更新ボタンの useFormStatus は囲みの form を
          拾い、各ハンドラは上の state/ref を触れる */}
      {hostEl &&
        createPortal(
          <EditToolbar
            onSubmit={submitForm}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={() => runHistoryCommand(undo)}
            onRedo={() => runHistoryCommand(redo)}
            uploadLabel={uploadButtonLabel(upload)}
            uploading={uploading}
            onInsertFile={() => fileInputRef.current?.click()}
            scanLabel={scanBusy ? "取得中" : "スキャン"}
            onScan={() => setScanning(true)}
            recordLabel={recordButtonLabel(
              recording.isRecording,
              recording.elapsedMs,
            )}
            isRecording={recording.isRecording}
            // 録音中だけは busy でも押せる。止められないと録音が終わらない
            recordDisabled={busy && !recording.isRecording}
            onToggleRecord={recording.toggle}
            onRecordVideo={videoRecording.openPreview}
            onDraw={openDrawing}
            ocrLabel={ocrButtonLabel(ocrCount)}
            onOcr={() => void runOcrAtCursor()}
            secretLabel={secretLabel}
            onSecret={openSecret}
            livePreview={livePreview}
            onToggleLivePreview={toggleLivePreview}
            onFormat={applyFormat}
            onAddPage={() => void addPage()}
            busy={busy}
          />,
          hostEl,
        )}
    </div>
  );
}
