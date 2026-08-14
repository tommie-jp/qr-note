import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { PrivateIcon, PublicIcon } from "@/components/MenuIcons";
import { PressTip } from "@/components/PressTip";
import { STATE_TOGGLE_CLASS } from "@/components/ui";

interface PublicToggleProps {
  itemNo: string;
  // 公開した日時 (null = 非公開)。値そのものは出さず、状態の判定だけに使う
  publicAt: Date | null;
  setPublicAction: (formData: FormData) => void | Promise<void>;
}

// 公開トグル (docs/22-ノート公開計画.md §7)。持ち主にだけ出す。
// 見出し行に畳んだ 1 つのボタン (docs/75-ノート上部圧縮計画.md §2)。
//
// **いまの状態を出す**ボタンで、押した後の動作名ではない。状態と操作を
// 1 つのボタンが兼ねる形なので、「公開する」と書くと「いま公開中」と読み違える。
//
// 元は全幅の帯で状態を文に書いていたが、非公開 (＝既定の状態) のノートを
// 開くたびに本文が下へ押しやられていた。公開の事故は取り返しがつかない
// (見た人の手元からは消せない) ので、そこは文ではなく**押した瞬間の確認**で
// 守る — 非公開 → 公開の側だけ ConfirmSubmitButton を通す。
//
// **文字も落としてアイコンだけにした** (docs/82-ノート操作アイコン計画.md §6)。
// 状態は絵 (錠前 / 地球儀) と色で言い、名前は aria-label が言う。既定の状態
// (非公開) を読み上げるためだけに見出し行の幅を払わない、というのは帯を
// やめたとき (docs/75 §1) と同じ判断の続き。
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
  const colorClass = isPublic
    ? "border-green-300 bg-green-50 text-green-900 hover:bg-green-100"
    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100";

  // 帯に書いていた説明は tooltip へ移した。**PC はホバー、スマホは長押し**で
  // 読める (PressTip。docs/82 §5) — docs/75 §3 で「スマホでは実質読めない」と
  // 承知で払った損を、ここで返している。
  //
  // 状態の名前 (非公開 / 公開中) を頭に置くのは、文字を落としたぶん
  // 「いまどちらなのか」を吹き出しでも言えるようにするため
  const hint = isPublic
    ? "公開中 — この URL を知っていれば誰でも見られます"
    : "非公開 — ログインした人だけが見られます";

  return (
    <form action={setPublicAction}>
      <input type="hidden" name="itemNo" value={itemNo} />
      <input type="hidden" name="public" value={isPublic ? "0" : "1"} />
      <PressTip label={hint}>
        {isPublic ? (
          // 公開をやめる側は確認を挟まない。押し間違えても元に戻せる。
          // aria-pressed は付けない — aria-label の文字が状態そのものなので、
          // 「押されている」が二重に読み上げられるだけになる
          <button
            type="submit"
            aria-label="公開中"
            className={`${STATE_TOGGLE_CLASS} ${colorClass}`}
          >
            <PublicIcon />
          </button>
        ) : (
          <ConfirmSubmitButton
            formAction={setPublicAction}
            confirmMessage={`#${itemNo} を公開します。URL を知っていれば誰でも見られます。よろしいですか?`}
            ariaLabel="非公開"
            className={`${STATE_TOGGLE_CLASS} ${colorClass}`}
          >
            <PrivateIcon />
          </ConfirmSubmitButton>
        )}
      </PressTip>
    </form>
  );
}
