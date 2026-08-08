import Link from "next/link";
import { tagSearchHref } from "@/lib/tags";

interface ItemTagsProps {
  tags: string[];
  // 省略 = リンクにしない (公開ビュー。docs/22-ノート公開計画.md §4)。
  // タグ検索は未ログインに閉じているので、押すと案内に化けるリンクは出さない
  // (ヘッダの「ログ」を未ログイン時に隠しているのと同じ判断)
  linked?: boolean;
}

const TAG_CLASS = "inline-flex min-h-9 items-center rounded-full px-3";

export function ItemTags({ tags, linked = true }: ItemTagsProps) {
  if (tags.length === 0) {
    return null;
  }

  return (
    // **折り返さず横スクロールさせる** (docs/62 §7)。タグを 10 個も付けた
    // ノートでは折り返した帯が 3 行 4 行と縦に伸び、本文が画面の下へ
    // 押し出されていた。タグは本文を読みに来た人にとって脇の情報なので、
    // 縦は 1 行ぶんに固定して、要る人だけ横へ送る。
    //
    // overscroll-x-contain … 端まで送った勢いが背後 (ページ全体) へ伝わって
    // 戻る操作に化けるのを防ぐ。
    // scrollbar-width:thin … 隠さない。隠すと PC では「まだ右にある」合図が
    // 一切なくなる (スマホは指で弾けば判るが、マウスでは判らない)
    <ul className="flex gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:thin]">
      {tags.map((tag) => (
        // shrink-0 … flex の既定では縮んでタグ名が潰れる。潰さず溢れさせる
        <li key={tag} className="shrink-0">
          {linked ? (
            <Link
              href={tagSearchHref(tag)}
              transitionTypes={["nav-back"]}
              className={`${TAG_CLASS} bg-gray-100 text-blue-700 transition-colors hover:bg-gray-200 active:bg-gray-300`}
            >
              #{tag}
            </Link>
          ) : (
            <span className={`${TAG_CLASS} bg-gray-100 text-gray-600`}>
              #{tag}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
