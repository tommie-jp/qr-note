// itemNo が既存ノートと衝突したときの扱い (docs/28-エクスポート計画.md §5)。
//
// **クライアントとサーバの両方から import する** (取り込み画面のラジオと
// /api/import のクエリが同じ 3 値を指す) ためにここへ切り出す。server 専用の
// 依存を持つファイルに置くと画面から読めなくなる (lib/zip/limits.ts と同じ理由)。

export type ConflictPolicy =
  // ZIP 側を見送り、既存のノートをそのまま残す (既定)
  | 'skip'
  // ZIP の内容で置き換える
  | 'overwrite'
  // 既存はそのまま、ZIP のノートに空き番号を振って両方残す
  | 'renumber'

const POLICIES: readonly string[] = ['skip', 'overwrite', 'renumber']

export const CONFLICT_POLICY_ERROR =
  'conflict には skip / overwrite / renumber のいずれかを指定して下さい'

// クエリの値を読む。**省略 (null) は skip**、それ以外で知らない値は null =
// 断る。
//
// 省略を安全側 (見送り) へ倒すのは §5 の判断 — 旗の欠落が無防備 (上書き・
// 複製) へ倒れないようにする。一方で**知らない値を黙って skip にはしない**:
// renumber のつもりのタイポが skip で走ると「取り込めたのに増えていない」に
// しか見えず、原因を探しようがない (export の scope と同じ主義)。
// `?conflict=` (空文字) も「指定したつもりで値が抜けた」形なので断る。
export function parseConflictPolicy(raw: string | null): ConflictPolicy | null {
  if (raw === null) {
    return 'skip'
  }
  return POLICIES.includes(raw) ? (raw as ConflictPolicy) : null
}
