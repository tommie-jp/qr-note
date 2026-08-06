import { NextResponse } from 'next/server'
import { denyCrossSite, denyIfDemoMode, denyUnlessLoggedIn } from '@/lib/apiAuth'
import { formatJstDate } from '@/lib/datetime'
import { parseSelectedItemNos } from '@/lib/itemSelection'
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
  const denied =
    denyIfDemoMode() ?? (await denyUnlessLoggedIn()) ?? denyCrossSite(request)
  if (denied) {
    return denied
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (error) {
    console.error('エクスポート要求の解析に失敗しました:', error)
    return errorResponse(400, 'フォームの形式が正しくありません')
  }

  const scope = formData.get('scope')
  if (scope !== 'all' && scope !== 'selected') {
    // **既定を「全件」に倒さない**。選択の受け渡しが壊れたときに黙って全件を
    // 書き出すより、断って気づけるほうがよい
    return errorResponse(400, 'scope には all か selected を指定して下さい')
  }

  // 番号の検証・重複除去・上限は一括操作 (タグ付け・ゴミ箱行き) と同じ
  // parseSelectedItemNos を通す。フォームの形が同じなので解釈も 1 か所に置く
  const itemNos = scope === 'selected' ? parseSelectedItemNos(formData) : null
  if (itemNos !== null && itemNos.length === 0) {
    return errorResponse(400, 'ノートが選択されていません')
  }

  return new Response(createZipStream(exportEntries(itemNos)), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${exportFileName()}"`,
      // ノート本文そのもの。共有キャッシュにも履歴にも残させない
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

// 中身が全件か選択かはファイル名で区別しない (frontmatter を見れば判る)。
// 日付は JST — 手元に落ちたときに「いつ取ったか」が地元の日付で読める
function exportFileName(): string {
  return `qr-search-export-${formatJstDate(new Date())}.zip`
}

function errorResponse(status: number, error: string): NextResponse {
  return NextResponse.json({ success: false, data: null, error }, { status })
}
