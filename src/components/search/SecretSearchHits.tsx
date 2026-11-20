"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { BusyNotice } from "@/components/chrome/BusyNotice";
import { LockIcon } from "@/components/icons";
import { CLIENT_NOTE_ATTR } from "@/lib/client/clientNoteNav";
import {
  matchSecretTexts,
  secretQueryTerms,
  secretSearchHits,
} from "@/lib/secret/search";
import {
  noteSecretSearchUse,
  type SecretSearchIndex,
  useSecretSearch,
} from "@/lib/secret/searchSession";
import { buildItemUrl } from "@/lib/search/url";
import type { Sort } from "@/lib/validation";

interface SecretSearchHitsProps {
  query: string;
  sort: Sort;
  // 一致を通常の一覧の行として出している (docs/131)。そのときここは見出し
  // (件数・断り) だけにして、行は出さない。一覧がまだ無いとき・画像表示・
  // モジュールの表示では偽で、今までどおりここに文字の行で出す
  rowsInList?: boolean;
}

// シークレット内の一致の節 (docs/130-シークレット内検索計画.md §3-2)。
//
// 通常の検索結果には混ぜず、一覧の先頭に別の節として出す。通常の結果は並び順・
// 件数・続きの読み込みがサーバ側にあり、混ぜると枠の先出し・前後ナビ・一括選択を
// 全部直すことになるため。
//
// **一致の中身はこの部品の描画の中にしか無い。** 照合は端末のメモリの平文に
// 対して行い、結果は一覧の控え (listStore) にもサーバにも渡さない。出すのも
// 題名とラベルだけで、一致箇所の抜粋は出さない (肩越しに読まれる)。
export function SecretSearchHits({ query, sort, rowsInList = false }: SecretSearchHitsProps) {
  const state = useSecretSearch();

  if (state.status === "off") {
    if (state.lockedOut) {
      // 自動施錠で切れた。黙って消えると「検索できなくなった」ように見える
      return (
        <p role="status" className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
          しばらく操作が無かったので施錠し、シークレット内の検索を切りました。🔒
          を押すと再開します。
        </p>
      );
    }
    // 入れようとして失敗した理由。取り消しは理由なしなので何も出ない
    return state.error === null ? null : (
      <p role="alert" className="rounded bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
        シークレット内の検索を始められませんでした: {state.error}
      </p>
    );
  }
  if (state.status === "loading") {
    return (
      <BusyNotice role="status" busy>
        シークレットを読み込み中…
      </BusyNotice>
    );
  }
  return <LoadedHits index={state.index} query={query} sort={sort} rowsInList={rowsInList} />;
}

function LoadedHits({
  index,
  query,
  sort,
  rowsInList,
}: SecretSearchHitsProps & { index: SecretSearchIndex }) {
  const terms = useMemo(() => secretQueryTerms(query), [query]);
  // 探している間は自動施錠を延ばす (照合は鍵に触れないので、印を自分で付ける)
  useEffect(() => noteSecretSearchUse(), [terms]);
  const hits = useMemo(
    () => secretSearchHits(index.entries, matchSecretTexts(index.haystacks, terms)),
    [index, terms],
  );

  return (
    <section
      aria-label="シークレット内の一致"
      className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm"
    >
      <h2 className="flex items-center gap-1.5 font-medium text-amber-900">
        <LockIcon size="regular" />
        {terms.length === 0
          ? `シークレット内も検索します (対象 ${index.entries.length} 件)`
          : `シークレット内の一致 ${hits.length} 件`}
      </h2>
      {terms.length === 0 ? (
        <p className="text-amber-800">
          検索語を入れると、シークレットの中身からも探します。
        </p>
      ) : null}
      {hits.length > 0 && !rowsInList ? (
        <ul className="mt-1 space-y-0.5">
          {hits.map((hit) => (
            <li key={`${hit.name}\u0000${hit.itemId}`}>
              <Link
                // 検索語は付けない。一致の節は通常の一覧と別物で「一覧の前後」の意味が
                // 無く、付けると開いた先の前後ナビの要求にまで語が載る
                href={buildItemUrl(hit.itemId, "", sort)}
                // **先読みさせない。** 節が画面に入っただけで `/item/<id>?q=<語>` の
                // 要求が飛ぶと、「どのノートの断片がその語を含むか」がサーバの
                // ログに並ぶ — 押す前から一致の中身を教えることになる (docs/130 §6)
                prefetch={false}
                // 検索画面のペインでは端末で開く印 (lib/client/clientNoteNav.ts)
                {...{ [CLIENT_NOTE_ATTR]: "" }}
                className="flex min-h-9 items-center gap-2 rounded px-1 text-blue-700 active:bg-amber-100"
              >
                <span className="min-w-0 truncate">{hit.title === "" ? "(無題)" : hit.title}</span>
                <span className="shrink-0 text-gray-600">🔒 {hit.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <IndexNotes index={index} />
    </section>
  );
}

// 探せなかった断片の断り。黙って対象から外すと「無い」と読み違える
function IndexNotes({ index }: { index: SecretSearchIndex }) {
  if (index.skipped === 0 && index.failed === 0) {
    return null;
  }
  return (
    <p className="mt-1 text-xs text-amber-800">
      {index.skipped > 0 ? `大きさの上限を超えた ${index.skipped} 件は対象外です。` : null}
      {index.failed > 0 ? `${index.failed} 件は読み取れず対象外です。` : null}
    </p>
  );
}
