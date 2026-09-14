import type { BookSummary } from "./book";
import type { ProductSummary } from "./product";
import { isIsbn, isJan } from "./scanRegister";

// 書誌 (docs/13-書誌自動取得計画.md) / 商品情報 (docs/14-JAN商品情報取得計画.md) の
// 取得。usePrefill (新規ノートの事前入力) と、編集中スキャンの挿入の両方が使う。
//
// 取得の流れは全く同じで、違うのは引く API ルートと文言だけなので、種別で分ける。
export type PrefillKind = "book" | "product";

export interface PrefillTarget {
  kind: PrefillKind;
  code: string;
}

const API_PATH: Record<PrefillKind, string> = {
  book: "/api/books",
  product: "/api/products",
};

// コードから取得対象を決める。ISBN なら書誌、それ以外の EAN-13 (JAN) なら商品、
// どちらでもなければ null (書籍・商品として引かない)。判定は scanRegister に委ねる
export function prefillTargetFromCode(code: string): PrefillTarget | null {
  if (isIsbn(code)) {
    return { kind: "book", code };
  }
  if (isJan(code)) {
    return { kind: "product", code };
  }
  return null;
}

// デモインスタンスは外部 API のキーを持たないため、取得の口が demoDisabled を
// 返す (docs/39-デモ公開計画.md §5)。通常の失敗 (error) とは分けて、専用の
// 文言を出したいので、独立した例外にして catch で見分ける。
export class DemoDisabledError extends Error {}

// 自分のサーバの /api/books/<isbn> か /api/products/<jan> を引く。
// 外部 API を直接叩かない理由は各ルート (route.ts) に書いてある
// (books は NDL の CORS、products はキーの秘匿)。
// 取得ごとの上限もサーバ側が持つ (external/sourceTimeout.ts)。
export async function fetchPrefillSummary(
  { kind, code }: PrefillTarget,
  signal?: AbortSignal,
): Promise<BookSummary | ProductSummary | null> {
  const res = await fetch(`${API_PATH[kind]}/${encodeURIComponent(code)}`, {
    signal,
  });
  const body = await res.json().catch(() => null);
  // デモは「失敗」ではなく「無効」。専用文言を出すため先に見分ける
  if (body?.demoDisabled) {
    throw new DemoDisabledError();
  }
  if (!res.ok || !body?.success) {
    throw new Error(body?.error ?? `取得に失敗しました (HTTP ${res.status})`);
  }
  return body.data;
}
