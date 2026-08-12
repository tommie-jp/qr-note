import { SearchQuery } from "@codemirror/search";
import type { EditorState } from "@codemirror/state";
import { secretNotationRanges } from "@/lib/secrets";
import { MAX_TEXT_LENGTH } from "@/lib/validation";

// ノート内検索・置換の素の計算 (docs/76-ノート内検索計画.md §8-1)。
//
// **EditorState しか見ない**。DOM もコンポーネントの state も触らないので、
// 件数の数え方・置換の組み方・守りの条件をここでテストできる
// (画面の側で確かめられるのは、押したら呼ばれることだけ)。
//
// 探すこと自体は @codemirror/search に任せる (SearchQuery.getCursor)。
// 折り返しや正規化 (NFKD) を自前で書き直す理由がない。

export interface MatchRange {
  from: number;
  to: number;
}

export interface MatchCount {
  total: number;
  // いま選んでいる一致が何番目か (1 始まり)。一致の上にいなければ 0
  current: number;
}

export interface ReplaceChange {
  from: number;
  to: number;
  insert: string;
}

export interface ReplaceAllPlan {
  changes: ReplaceChange[];
  count: number;
  // シークレット記法に重なるため飛ばした一致の数 (§5-4)
  skipped: number;
  // 本文の上限を超えるので実行しない (§5-3)。このとき changes は空
  tooLong: boolean;
}

export interface ReplaceOnePlan {
  change: ReplaceChange | null;
  tooLong: boolean;
  // シークレット記法に重なるため置き換えなかった (§5-4)。このとき change は null
  secret: boolean;
}

export interface NoteSearchNote {
  text: string;
  // 「元に戻す」を添えるか。断り (上限超え・0 件) には添えない
  undo: boolean;
}

// 検索条件を組む。
//
// **literal: true** … 既定の CodeMirror は検索語の `\n` `\r` `\t` を制御文字に
// 読み替える。コードや Windows のパスを書き留めるこの本文では、打った文字が
// そのまま探されるほうが驚きが少ない。
//
// **regexp は持たない** (§7)。全置換といちばん相性が悪く、無効なパターンの
// 表示までを狭い帯に載せる釣り合いが取れない。
export function buildQuery(
  search: string,
  replace: string,
  caseSensitive: boolean,
): SearchQuery {
  return new SearchQuery({ search, replace, caseSensitive, literal: true });
}

// 一致をすべて歩く。SearchCursor は Iterator なので、結果オブジェクトから読む
// (cursor.value を直接読む書き方は d.ts に無い)
function* iterMatches(
  state: EditorState,
  query: SearchQuery,
): Generator<MatchRange> {
  if (!query.valid) {
    return;
  }
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    yield { from: next.value.from, to: next.value.to };
  }
}

export function countMatches(
  state: EditorState,
  query: SearchQuery,
): MatchCount {
  const selection = state.selection.main;
  let total = 0;
  let current = 0;
  for (const match of iterMatches(state, query)) {
    total++;
    if (match.from === selection.from && match.to === selection.to) {
      current = total;
    }
  }
  return { total, current };
}

// pos 以降の最初の一致。末尾まで無ければ先頭へ折り返す (見つからなければ null)。
//
// 打つたびに「いま見えている所から先の一致」へ飛ぶための土台。findNext と
// 違って**選択を動かさない** — 呼ぶ側が飛び先を決める
export function firstMatchFrom(
  state: EditorState,
  query: SearchQuery,
  pos: number,
): MatchRange | null {
  let wrapped: MatchRange | null = null;
  for (const match of iterMatches(state, query)) {
    if (match.from >= pos) {
      return match;
    }
    wrapped ??= match;
  }
  return wrapped;
}

// 置換後の本文が上限を超えるか。
//
// **超える変更は changeFilter (MemoEditorInner) に黙って捨てられる**ので、
// 押したのに何も起きない状態になる。組む前にここで判る
function exceedsLimit(state: EditorState, delta: number): boolean {
  return state.doc.length + delta > MAX_TEXT_LENGTH;
}

export function planReplaceAll(
  state: EditorState,
  query: SearchQuery,
): ReplaceAllPlan {
  const empty: ReplaceAllPlan = {
    changes: [],
    count: 0,
    skipped: 0,
    tooLong: false,
  };
  if (!query.valid) {
    return empty;
  }
  // シークレット記法の中は書き換えない (§5-4)。記法が 1 つも無い本文
  // (ほとんどのノート) では正規表現を 1 回走らせるだけで終わる
  const guarded = secretNotationRanges(state.doc.toString());
  const changes: ReplaceChange[] = [];
  let skipped = 0;
  let delta = 0;
  for (const match of iterMatches(state, query)) {
    const overlapsSecret = guarded.some(
      (range) => match.from < range.to && match.to > range.from,
    );
    if (overlapsSecret) {
      skipped++;
      continue;
    }
    changes.push({ ...match, insert: query.replace });
    delta += query.replace.length - (match.to - match.from);
  }
  if (exceedsLimit(state, delta)) {
    return { ...empty, skipped, count: changes.length, tooLong: true };
  }
  return { changes, count: changes.length, skipped, tooLong: false };
}

// 本文の上限で断るときの文 (置換 1 件・すべての両方から使う)。
//
// **数字を必ず出す。** 「置換できません」だけだと、押しても何も起きないのと
// 区別が付かない — 何字までなら入るのかが判れば、消してからやり直せる
export function overLimitNote(): NoteSearchNote {
  return {
    text: `本文が上限 ${MAX_TEXT_LENGTH.toLocaleString()} 字を超えるため置換しませんでした`,
    undo: false,
  };
}

// 全置換の後に出す知らせ (docs/76 §5-2)。
//
// 飛ばしたシークレットは**必ず言う**。黙っていると「置換したのに 1 件だけ
// 古いまま」に見え、壊れているのはこちらだと疑うことになる
export function replaceAllNote(plan: ReplaceAllPlan): NoteSearchNote {
  if (plan.tooLong) {
    return overLimitNote();
  }
  const skipped =
    plan.skipped > 0 ? ` (シークレット ${plan.skipped} 件は対象外)` : "";
  if (plan.count === 0) {
    return {
      text: plan.skipped > 0 ? `置換できる一致がありません${skipped}` : "一致がありません",
      undo: false,
    };
  }
  return { text: `${plan.count} 件置換しました${skipped}`, undo: true };
}

// 「置換」(1 件): いま選んでいる範囲がちょうど一致なら、それを置き換える。
// 一致の上にいなければ null (呼ぶ側は置き換えずに次へ進む)。
//
// **シークレットの守りは全置換と同じに掛ける** (§5-4)。「狙って押す 1 件だから
// 巻き込まない」と考えて外していたが、押すと呼び側が findNext で次へ進むので、
// 連打すれば自分で見ていない一致にも当たる — `api` を検索して置換を続けると
// `![ラベル](secret:<uuid>)` の中に届き、断片の参照が切れる (戻せない)。
export function planReplaceCurrent(
  state: EditorState,
  query: SearchQuery,
): ReplaceOnePlan {
  const empty: ReplaceOnePlan = {
    change: null,
    tooLong: false,
    secret: false,
  };
  const { from, to } = state.selection.main;
  if (!query.valid || from === to) {
    return empty;
  }
  const match = firstMatchFrom(state, query, from);
  if (!match || match.from !== from || match.to !== to) {
    return empty;
  }
  const overlapsSecret = secretNotationRanges(state.doc.toString()).some(
    (range) => from < range.to && to > range.from,
  );
  if (overlapsSecret) {
    return { ...empty, secret: true };
  }
  if (exceedsLimit(state, query.replace.length - (to - from))) {
    return { ...empty, tooLong: true };
  }
  return { ...empty, change: { from, to, insert: query.replace } };
}

// 置換 1 件の後に出す知らせ。**置き換えられなかった理由があるときだけ**返す
// (ふつうに置き換えたときと空振りのときは null = 知らせを畳む)。
//
// 理由を出さないと「押したのに何も起きない」になり、壊れているのはこちらだと
// 疑うことになる — 全置換が飛ばしたシークレットを必ず言うのと同じ理由
export function replaceOneNote(plan: ReplaceOnePlan): NoteSearchNote | null {
  if (plan.tooLong) {
    return overLimitNote();
  }
  if (plan.secret) {
    return {
      text: "シークレット記法の中なので置換しませんでした",
      undo: false,
    };
  }
  return null;
}
