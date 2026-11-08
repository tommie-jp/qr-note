// 予定のノートの本文を保存する (フォームと「済み」の釦が共有する)。
// 409 は「いまのサーバの版」が違う (docs/87)。base は formatBase で作る
export type SaveResult =
  | { kind: "saved"; dto?: unknown }
  | { kind: "error"; message: string; reload?: boolean };

const CONFLICT_MESSAGES: Record<string, string> = {
  conflict: "別の画面でこのノートが書き換えられています。読み直してからもう一度保存してください。",
  exists: "このノートは別の画面で先に作られています。読み直してからもう一度保存してください。",
  missing: "このノートは削除されています。",
};

// 本文を保存する。409 は「いまのサーバの版」が違う (docs/87)
export async function putMemo(itemId: string, memo: string, base: string): Promise<SaveResult> {
  let response: Response;
  try {
    response = await fetch(`/api/items/${encodeURIComponent(itemId)}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memo, base, checkpoint: false }),
    });
  } catch {
    return { kind: "error", message: "通信できませんでした。電波の届く所でもう一度お試しください" };
  }
  if (response.status === 401) {
    window.location.reload();
    return { kind: "error", message: "ログインが必要です" };
  }
  const body = (await response.json().catch(() => null)) as
    | { success?: boolean; data?: { item?: unknown; state?: { kind?: string } }; error?: unknown }
    | null;
  if (response.status === 409) {
    const kind = body?.data?.state?.kind ?? "conflict";
    return { kind: "error", message: CONFLICT_MESSAGES[kind] ?? CONFLICT_MESSAGES.conflict, reload: kind !== "missing" };
  }
  if (!response.ok || body?.success !== true) {
    const message = typeof body?.error === "string" ? body.error : `保存できませんでした (${response.status})`;
    return { kind: "error", message };
  }
  return { kind: "saved", dto: body.data?.item };
}
