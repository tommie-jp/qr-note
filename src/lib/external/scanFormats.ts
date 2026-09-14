import type { IScannerProps } from '@yudiel/react-qr-scanner'

// スキャナが受け取れるフォーマット名。barcode-detector から直接 import しない。
// あれは @yudiel/react-qr-scanner の依存であってこちらの直接依存ではなく、
// npm のフラットな巻き上げに頼る形になる (依存が上がると黙って壊れる)。
// 使う相手の props から導けば、その相手とずれようがない
type ScanFormat = NonNullable<IScannerProps['formats']>[number]

// スキャナが読むコードの種類 (設計は docs/09-スキャン計画.md §4)。
//
// 対応可能な全フォーマット (any) にはしない。code_39 や codabar のように
// チェックデジットの弱い 1D コードを混ぜると、カメラのノイズを短いコードとして
// 誤検出することがある。使う予定のあるものだけ挙げ、増やすときはここへ 1 行足す。
//
// 除外している主なもの:
//   maxi_code … zxing-cpp がカメラ映像からの位置特定に対応しておらず実質読めない
//   code_39 / codabar / databar 系 / telepen … 使う当てがなく、誤検出だけ増える
export const SCAN_FORMATS: ScanFormat[] = [
  // 2D: 部品シール (QR) と工業系
  'qr_code',
  'micro_qr_code',
  'data_matrix',
  // 小売系 1D: 書籍 ISBN と JAN はここ (どちらも実体は ean_13)
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  // 工業系 1D
  'code_128',
  'itf',
]
