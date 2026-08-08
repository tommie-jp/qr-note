interface PublicToggleProps {
  itemNo: string;
  // 公開した日時 (null = 非公開)。値そのものは出さず、状態の判定だけに使う
  publicAt: Date | null;
  setPublicAction: (formData: FormData) => void | Promise<void>;
}

// 公開トグル (docs/22-ノート公開計画.md §7)。持ち主にだけ出す。
//
// **いまの状態を文で書く**のが要点。トグルの絵だけだと、どちらが現在で
// どちらが押した後なのかが読み取れない。公開は事故ると取り返しがつかない
// (見た人の手元からは消せない) ので、押す前に状態が判るようにする。
//
// フォームが送るのは「望む状態」であって「裏返せ」ではない。二重送信や
// 戻るボタンで意図と逆に倒れないようにするため (actions.ts 側も同じ約束)。
export function PublicToggle({
  itemNo,
  publicAt,
  setPublicAction,
}: PublicToggleProps) {
  const isPublic = publicAt !== null;

  // 公開中は緑。「いま外から見える」は非公開より強い状態なので、
  // 地の色 (gray) と見分けが付くようにする
  const boxClass = isPublic
    ? "border-green-300 bg-green-50 text-green-900"
    : "border-gray-200 bg-gray-50 text-gray-600";

  const buttonClass = isPublic
    ? "border-green-300 bg-white text-green-900 hover:bg-green-100 active:bg-green-200"
    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100 active:bg-gray-200";

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded border px-3 py-2 ${boxClass}`}
    >
      <p className="flex-1">
        {isPublic ? (
          <>
            <span aria-hidden>🌐 </span>
            <span className="font-medium">公開中</span> — この URL
            を知っていれば誰でも見られます。
          </>
        ) : (
          // 非公開は**このアプリの既定の状態**なので、説明を添えない
          // (docs/62 §8)。ノートを開くたびに読まされる 1 行は、意味を
          // 伝えるより先に本文を下へ押しやる。公開中の側に文が残るのは、
          // あちらが「事故ると取り返しがつかない」状態だから — 見た人の
          // 手元からは消せないので、そこだけは毎回言う値打ちがある
          <>
            <span aria-hidden>🔒 </span>
            <span className="font-medium">非公開</span>
          </>
        )}
      </p>
      <form action={setPublicAction}>
        <input type="hidden" name="itemNo" value={itemNo} />
        <input type="hidden" name="public" value={isPublic ? "0" : "1"} />
        <button
          type="submit"
          className={`inline-flex min-h-9 items-center rounded border px-3 font-medium transition-colors ${buttonClass}`}
        >
          {isPublic ? "非公開にする" : "公開する"}
        </button>
      </form>
    </div>
  );
}
