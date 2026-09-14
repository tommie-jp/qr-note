import Link from "next/link";
import { DebugConsoleButton } from "@/components/DebugConsoleButton";
import { HeaderMenu } from "@/components/HeaderMenu";
import { HeaderQrButton } from "@/components/HeaderQrButton";
import { LoginButton } from "@/components/LoginButton";
import { LogoutButton } from "@/components/LogoutButton";
import {
  GithubIcon,
  HistoryIcon,
  ImportIcon,
  InfoIcon,
  KeyIcon,
  LockIcon,
  LogIcon,
} from "@/components/icons";
import { PasskeyLoginButton } from "@/components/PasskeyLoginButton";
import { RowTintMenuItem } from "@/components/bottombar/RowTintMenuItem";
import { TextSizeMenuItem } from "@/components/bottombar/TextSizeMenuItem";
import { HEADER_MENU_ITEM_CLASS } from "@/components/ui";
import { PASSKEY_SETTINGS_PATH } from "@/lib/auth/paths";
import type { RowTintId } from "@/lib/prefs/rowTint";
import { SECRET_SETTINGS_PATH } from "@/lib/secret/secrets";

const GITHUB_URL = "https://github.com/tommie-jp/qr-note";

interface AppHeaderMenuProps {
  // ヘッダーの帯と同じ地色 (AppHeader.tsx の headerBgClass)
  bgClass: string;
  user: string | null;
  isDemo: boolean;
  rowTintId: RowTintId;
  siteUrl: string;
  siteQrDataUrl: string;
}

// ヘッダーのハンバーガーメニューに畳んだ項目 (docs/11-アプリ的UIUX計画.md §6)。
// サーバコンポーネントで、ログイン状態・デモによる出し分けはここで組む。
// 開閉と portal はクライアント側の HeaderMenu が持ち、ここは children を渡すだけ。
//
// ログイン手段 (パスワード / パスキー) によらず必ずセッションを持つので
// (docs/18 §11)、ログイン中なら常にログアウトを出してよい
export function AppHeaderMenu({
  bgClass,
  user,
  isDemo,
  rowTintId,
  siteUrl,
  siteQrDataUrl,
}: AppHeaderMenuProps) {
  return (
    <HeaderMenu bgClass={bgClass}>
      <HeaderQrButton qrDataUrl={siteQrDataUrl} url={siteUrl} variant="menu" />
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={HEADER_MENU_ITEM_CLASS}
      >
        <GithubIcon />
        GitHub
      </a>
      {/* 外部 API のクレジット/帰属表示 (docs/46-クレジット表記計画.md)。
          Yahoo! は表示が義務。誰に対しても出してよい情報なので、
          ログイン状態・デモに依らず (!isDemo の内側に入れない) 常に出す */}
      <Link href="/about" className={HEADER_MENU_ITEM_CLASS}>
        <InfoIcon />
        クレジット
      </Link>
      {/* 本文の文字サイズ (docs/61-テキストサイズ計画.md)。
          ログイン状態やデモに依らず出す — 読みやすさの設定であって、
          ノートを持っているかとは関係がない (公開ノートにも効く) */}
      <TextSizeMenuItem />
      {user ? (
        <>
          {/* デモでは設定系の導線を出さない (docs/38-デモモード計画.md §4)。
              ログ・パスキー・インポートはいずれもページ/API 側でも
              塞いでいるが、押せない物を見せない */}
          {!isDemo && (
            <>
              {/* 検索結果で選択中の行の色 (docs/88-選択行の色計画.md)。
                  テキストサイズのすぐ下に置く — どちらも「どう見えるか」
                  の設定で、探す場所は同じであってほしい。
                  **ログイン中の非デモだけ**: 保存先が user_settings なので
                  未ログインでは保存する相手がおらず、デモは共有アカウント
                  なので 1 人が変えると同時に見ている全員の色が変わる */}
              <RowTintMenuItem value={rowTintId} />
              {/* サーバログ (docs/21)。未ログインではリンク自体を出さない —
                  見えても 401 だが、押せない物を見せない */}
              <Link href="/logs" className={HEADER_MENU_ITEM_CLASS}>
                <LogIcon />
                ログ
              </Link>
            </>
          )}
          {/* その場で見る側のログ (docs/30-ブラウザログ計画.md §2)。
              /logs は事後に読むもので、network まで見たいときは
              端末の上に DevTools 相当を出すしかない。デモでも自分の
              セッション内で完結するので残す (docs/38 §8) */}
          <DebugConsoleButton />
          {!isDemo && (
            <>
              {/* パスキーの管理 (docs/29-パスキー計画.md §8)。
                  ここが登録への唯一の導線なので、ログイン中は常に出す */}
              <Link href={PASSKEY_SETTINGS_PATH} className={HEADER_MENU_ITEM_CLASS}>
                <KeyIcon />
                パスキー
              </Link>
              {/* シークレット (部分暗号化) の鍵 (docs/51-部分暗号化計画.md §6)。
                  解錠はノートを開いたときにも促されるが、初回設定と
                  復旧キーの入口はここだけ */}
              <Link href={SECRET_SETTINGS_PATH} className={HEADER_MENU_ITEM_CLASS}>
                <LockIcon />
                シークレット
              </Link>
              {/* ノートの持ち出しと取り込み (docs/28-エクスポート計画.md
                  §7)。全件エクスポートと、ZIP / Evernote (.enex) の
                  取り込みを 1 画面にまとめてある — 書き出す場所と戻す
                  場所が同じなら、往復の説明も 1 か所で済む。
                  たまにしか使わないのでメニューの奥でよいが、導線が
                  ここしか無いので出しておく */}
              <Link href="/settings/import" className={HEADER_MENU_ITEM_CLASS}>
                <ImportIcon />
                インポート / エクスポート
              </Link>
              {/* 既存ノートの git 履歴への取り込み (docs/57-ノートgit
                  履歴計画.md §6)。ほぼ一度きりの操作だが、導線が
                  ここしか無いので出しておく (インポートと同じ判断) */}
              <Link href="/settings/history" className={HEADER_MENU_ITEM_CLASS}>
                <HistoryIcon />
                履歴取り込み
              </Link>
            </>
          )}
          <LogoutButton variant="menu" />
        </>
      ) : (
        <>
          <PasskeyLoginButton variant="menu" />
          <LoginButton variant="menu" label="パスワードでログイン" />
        </>
      )}
    </HeaderMenu>
  );
}
