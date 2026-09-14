import { formatJstDate } from '@/lib/datetime'
import { parseSelectedItemNos } from '@/lib/items/itemSelection'
import { guardRequest } from '@/lib/route/guard'
import { byteHeaders } from '@/lib/route/bytes'
import { parseFormBody } from '@/lib/route/parse'
import { apiFail, WITHOUT_CACHE_CONTROL } from '@/lib/route/respond'
import { exportEntries } from '@/lib/zip/exportZip'
import { createZipStream } from '@/lib/zip/zipStream'

// ノートを ZIP で書き出す (docs/28-エクスポート計画.md §7)。
//
// **口は 1 本**。form の `scope` が all なら全件、selected なら `itemNo` で
// 選んだぶんだけを入れる。全件用と選択用でエンドポイントを分けない。
//
// GET ではなく POST なのは 2 つの理由から:
//   - 選んだ itemNo の列が URL 長の実用上限 (~2KB) に収まる保証がない
//   - <form method="post"> の画面遷移ならブラウザが Content-Disposition を
//     そのままダウンロードとして受ける。fetch + blob と違い、JS がファイル
//     全体をメモリに抱えない (スマホ + 画像入り ZIP で効く)
//
// 応答はストリーム。添付は DB の bytea にあり、全件を集めると本番 VPS
// (RAM 2GB) では足りない (lib/zip/zipStream.ts)。
export async function POST(request: Request): Promise<Response> {
  // デモでは閉じる (docs/38 §4)。共有アカウントのデモに「全データを 1 ファイルで
  // 持ち出す口」を開けておく理由がない。インポートと同じ判断・同じ並び順
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }

  const form = await parseFormBody(
    request,
    { log: 'エクスポート要求の解析に失敗しました:', message: 'フォームの形式が正しくありません' },
    WITHOUT_CACHE_CONTROL,
  )
  if (!form.ok) {
    return form.response
  }
  const formData = form.value

  const scope = formData.get('scope')
  if (scope !== 'all' && scope !== 'selected') {
    // **既定を「全件」に倒さない**。選択の受け渡しが壊れたときに黙って全件を
    // 書き出すより、断って気づけるほうがよい
    return apiFail('scope には all か selected を指定して下さい', 400, WITHOUT_CACHE_CONTROL)
  }

  // 番号の検証・重複除去・上限は一括操作 (タグ付け・ゴミ箱行き) と同じ
  // parseSelectedItemNos を通す。フォームの形が同じなので解釈も 1 か所に置く
  const itemNos = scope === 'selected' ? parseSelectedItemNos(formData) : null
  if (itemNos !== null && itemNos.length === 0) {
    return apiFail('ノートが選択されていません', 400, WITHOUT_CACHE_CONTROL)
  }

  return new Response(createZipStream(exportEntries(itemNos)), {
    headers: byteHeaders({
      contentType: 'application/zip',
      extra: { 'Content-Disposition': `attachment; filename="${exportFileName()}"` },
      // ノート本文そのもの。共有キャッシュにも履歴にも残させない
      cacheControl: 'no-store',
    }),
  })
}

// 中身が全件か選択かはファイル名で区別しない (frontmatter を見れば判る)。
// 日付は JST — 手元に落ちたときに「いつ取ったか」が地元の日付で読める
function exportFileName(): string {
  return `qr-note-export-${formatJstDate(new Date())}.zip`
}
