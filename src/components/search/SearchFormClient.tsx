"use client";

import type { ComponentProps } from "react";
import { SearchForm } from "@/components/search/SearchForm";
import { tagsCache } from "@/lib/client/listStore";
import { useSearchState } from "@/lib/client/useSearchState";
import type { Sort } from "@/lib/validation";

// 検索窓 (docs/123 §4-2)。検索語は URL から、タグの補完は GET /api/tags から。
// タグが届くまでは補完なしで打てる (数十 ms 遅れて補完が付く)
export function SearchFormClient({
  cookieSort,
  ...rest
}: Omit<ComponentProps<typeof SearchForm>, "initialQuery" | "tags"> & { cookieSort: Sort }) {
  const { query } = useSearchState(cookieSort);
  const tags = tagsCache.useEntry("all")?.value;
  return <SearchForm initialQuery={query} tags={tags?.map((t) => t.tag) ?? EMPTY} {...rest} />;
}

const EMPTY: string[] = [];
