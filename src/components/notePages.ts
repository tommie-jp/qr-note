import type { Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { memoSummary } from "@/lib/memoSummary";
import { BASE_REMARK_PLUGINS } from "./remarkPlugins";

// ノートをページに分ける (docs/74-ページ計画.md)。
//
// **正本はメモ本文**。ページは水平線 (`---`) からその場で導く派生で、
// 表も列も持たない (タグ・チェック数・quiz フェンスと同じ作法)。
//
// **区切りの判定は remark に任せる**。自前の `/^-{3,}$/` では、段落の直後の
// 罫線 (`赤LED` + `------` = setext 見出しの下線) まで区切りに見えて、
// 表が真っ二つになる。circuitFences.ts が正規表現ではなく remark を使うのと
// 同じ理由で、**表示側と必ず同じ解釈にする**。
//
// lib ではなくここに置いてあるのは、描画と**同じプラグイン列**
// (remarkPlugins.ts の BASE_REMARK_PLUGINS) を共有するため。1 つでも欠けると
// 同じ本文が画面とページ分割で違う形に読まれる — 折りたたみを知らなければ
// `:::details` の中の水平線で割れ、表を知らなければ表の直後の `---` が
// setext 見出しの下線に見えて区切りが消え、数式を知らなければブロック数式の
// 中で割れる (詳しくは remarkPlugins.ts)。

// 書き手に案内する区切り (docs/メモ記法.md)。`***` / `___` も CommonMark の
// 水平線なので remark は同じく区切りと読むが、案内するのはこれ 1 つに絞る
const PAGE_SEPARATOR = "---";

export interface NotePage {
  // ページの先頭行から作った見出し (memoSummary)。中身が無ければ空文字
  name: string;
  // memo の切れ端そのもの (区切り行は含まない)。start + body.length === end
  body: string;
  start: number;
  end: number;
  // 本文の中でこのページが始まる行番号 (1 始まり)。
  //
  // **チェックボックスの行番号のため**に要る。ページを別々に描くと
  // rehypeTaskLines が刻む行番号がページの中で 1 に戻り、2 ページ目の
  // チェックを押すと 1 ページ目の行が書き換わる (docs/55 の行番号は
  // 本文全体に対する番号)
  line: number;
}

function makePage(
  memo: string,
  start: number,
  end: number,
  line: number,
): NotePage {
  const body = memo.slice(start, end);
  return { name: memoSummary(body), body, start, end, line };
}

// [from, to) にある改行の数。開始行は前のページから積み上げる — ページごとに
// 先頭から数え直すと、60 ページのノートで本文を 60 回なぞることになる
function countNewlines(memo: string, from: number, to: number): number {
  let count = 0;
  for (let i = from; i < to; i++) {
    if (memo[i] === "\n") {
      count++;
    }
  }
  return count;
}

// 水平線になりうる行 (`-` / `*` / `_` と空白だけで出来た 3 文字以上の行)。
// **本物の規則より広く拾う**判定で、これに 1 行も当たらない本文は remark を
// 通さずに 1 ページとして返す。一覧は 60 件をまとめて描くので、パースを
// 省ける効果が効く (実データでは 599 件中 11 件しか当たらない)。
// 迷ったら通す側へ倒すこと — 狭いと区切りを見落とす
const MAYBE_THEMATIC_BREAK = /^[ \t]*[-*_][ \t]*[-*_][ \t]*[-*_][-*_ \t]*$/m;

export function splitPages(memo: string): NotePage[] {
  if (!MAYBE_THEMATIC_BREAK.test(memo)) {
    return [makePage(memo, 0, memo.length, 1)];
  }

  // parse だけで足りる (run は要らない) — 区切りは構文の段階で決まる。
  // ただしプラグインの登録は描画と同じにしておかないと、micromark 拡張を
  // 持つもの (表・数式・折りたたみ) の読み方がずれる
  const tree = unified()
    .use(remarkParse)
    .use(BASE_REMARK_PLUGINS)
    .parse(memo) as Root;

  const pages: NotePage[] = [];
  let start = 0;
  let line = 1;
  // **最上位の子だけを見る**。引用・リスト・折りたたみの中の水平線は
  // その入れ物の一部で、ノートを割る区切りではない
  for (const node of tree.children) {
    if (node.type !== "thematicBreak") {
      continue;
    }
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from === undefined || to === undefined) {
      continue;
    }
    pages.push(makePage(memo, start, from, line));
    // 区切り行そのものの改行までを区切りに含める。remark の end.offset は
    // `---` の直後 (改行の手前) を指すので、そのままだと次のページの本文が
    // 空行 1 つ分ずれて始まる
    const next = to + (/^\r?\n/.exec(memo.slice(to, to + 2))?.[0].length ?? 0);
    line += countNewlines(memo, start, next);
    start = next;
  }
  // 末尾のページ。区切りが無ければこれだけが返る (= 1 ページのノート)。
  // **空でも捨てない** — ＋ を押した直後は「末尾に空のページがある」状態
  // そのもので、畳むと押しても増えていないように見える
  pages.push(makePage(memo, start, memo.length, line));
  return pages;
}

// offset がどのページに居るか。区切り行の上 (ページとページの隙間) は
// ひとつ前のページの終わり際として扱う — ＋ の挿入位置がカーソルの目の前に
// なるほうが、押した結果を予想しやすい
export function pageIndexAt(pages: readonly NotePage[], offset: number): number {
  for (let i = pages.length - 1; i > 0; i--) {
    if (offset >= pages[i].start) {
      return i;
    }
  }
  return 0;
}

export interface PageInsertion {
  // 置き換える範囲 (ページ末尾の空白行を畳む)
  from: number;
  to: number;
  insert: string;
  // 挿入後にカーソルを置く位置 = 新しいページの先頭
  cursor: number;
}

// ＋ で新しいページを足す編集。**カーソルのあるページの直後**に入れる —
// 末尾固定にしない (5 ページ書いた後に 2 ページ目を足したいことのほうが多い)。
//
// ページ末尾の空白行は挿入した区切りで置き換える。残すと押すたびに
// 空行が積み上がる
export function newPageInsertion(memo: string, offset: number): PageInsertion {
  const pages = splitPages(memo);
  const page = pages[pageIndexAt(pages, offset)];
  const from = page.start + page.body.trimEnd().length;
  // ノートの先頭に足すときだけ前の空行が要らない
  const insert = `${from === 0 ? "" : "\n\n"}${PAGE_SEPARATOR}\n\n`;
  return { from, to: page.end, insert, cursor: from + insert.length };
}

// 一覧の顔に使う 1 ページ目 (docs/74 §6)。
//
// 中身のあるページまで進むのは、一覧のタイトル (memoSummary) が水平線を
// 読み飛ばして 2 ページ目の見出しを拾うため。ここで 1 ページ目の空白を
// 返すと、同じ行に見出しだけあって絵が空という食い違いが出る
export function firstPageSource(memo: string): string {
  const pages = splitPages(memo);
  return pages.find((page) => page.body.trim() !== "")?.body ?? "";
}
