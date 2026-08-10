// 動くサムネを「1 セッションで何本まで自動再生してよいか」の勘定
// (docs/72-動画アニメサムネ計画.md §Phase3)。
//
// ホバーの無い端末 (スマホ) では、画面に入った動くサムネを自動で差し替える。
// 一覧は延々とスクロールできるので、素直に「見えたら差し替える」だけだと
// 最後まで見た人が全件ぶんを引くことになる (13-kick-work では 900 行あり、
// 実際にこの上限を入れた)。
//
// useAnimThumb.ts から切り出した純関数。React の外に出しておくと、勘定の
// 規則そのものをテストできる (animThumbBudget.test.ts)。

// 自動再生してよい本数。1 本あたり最大 MAX_VIDEO_ANIM_BYTES (300KB) なので、
// 最悪でも約 9MB で頭打ちになる。実測ではもっと軽い。
export const MAX_AUTO_ANIM = 30

// 「しっかり画面に入った」とみなす可視率。速いスクロールで一瞬かすめただけの
// サムネに上限の枠を食わせないため、手前から先読みはしない。
export const AUTO_VISIBLE_RATIO = 0.6

// 可視率の比較に持たせる余裕。閾値をまたいだ瞬間の報告値は 0.5999… のように
// 僅かに下回ることがあり、そこで弾くと、以後スクロールしても新たな閾値越えが
// 起きず永久に動かないサムネができる。
const VISIBLE_EPSILON = 0.01

// 自動再生してよいほど画面に入っているか。
//
// **IntersectionObserver の threshold を渡すだけでは足切りにならない。**
// 交差の報告は isIntersecting (少しでも重なれば true) でも飛んでくるので、
// 判定は交差率そのものでやる必要がある。素通しすると、下端に 5% だけ覗いた
// サムネが次々と枠を取り、目当ての動画に着く前に上限を使い切る。
export function isVisibleEnough(ratio: number): boolean {
  return ratio >= AUTO_VISIBLE_RATIO - VISIBLE_EPSILON
}

// 枠を取れたら true。取れなければ差し替えない (静止サムネのまま)。
//
// **同じサムネは何度でも取れる**のが要点。画面を出入りするたびに数えると
// 行き来しただけで枠が尽きるし、二度目以降はブラウザのキャッシュから出るので
// 転送も増えない。
export function takeAutoAnimSlot(
  played: Set<string>,
  key: string,
  max: number = MAX_AUTO_ANIM,
): boolean {
  if (played.has(key)) {
    return true
  }
  if (played.size >= max) {
    return false
  }
  played.add(key)
  return true
}

// 取った枠を返す。未生成 (404) で一度も再生できなかったときに使う。
// 返さないと、生成されていない動画が並ぶ一覧で 404 だけで枠を使い切る。
export function releaseAutoAnimSlot(played: Set<string>, key: string): void {
  played.delete(key)
}
