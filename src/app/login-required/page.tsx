import type { Metadata } from "next";
import { LoginRequiredNotice } from "@/components/LoginRequiredNotice";

// サイト名は付けない。root layout の title.template が付ける
// (手で連結すると非本番の [LOCAL] が抜け落ちる)
export const metadata: Metadata = {
  title: "ログインが必要です",
};

// 未ログインで保護された画面を開いたときの案内 (docs/18-ログイン計画.md)。
//
// proxy.ts がここへ rewrite する。redirect ではないのでアドレス欄は元の URL
// (例: /item/ABC123) のまま。ログインすれば再読み込みだけでその場に戻る。
//
// 直接 /login-required を開くこともできる (auth/publicPaths.ts で公開している) が、
// 出るのはこの案内だけなので害はない。
//
// 中身は LoginRequiredNotice に置いた。/item と /print は proxy が素通しする
// 口なので、公開ノートでなかったとき同じ案内を自分で出す (docs/22 §4)。
export default function LoginRequiredPage() {
  return <LoginRequiredNotice />;
}
