import { makeNonce, panelHtml } from "fence-kit/shell";
import type { FenceEditor, Incoming, Outgoing } from "fence-kit/shell";
import { errorText } from "@/lib/errorMessage";
import { createFenceGuiSession } from "@/lib/fenceGui/session";

export { FENCE_MAP_SCRIPT } from "@/lib/fenceGui/mapScript";

// 図を掴んで動かす殻を iframe に開く (docs/99-フェンスGUI編集計画.md)。
// 上流 playground の src/map/index.ts の写し — **iframe を webview の代わりに
// する**。拡張では VS Code が webview を用意して postMessage で話す。その形を
// そのまま写すと、殻も中身も 1 行も変えずに動く (52 の docs/15)。
//
// 中の頁 (srcdoc) は二重に閉じてある (docs/99 §2 の決め 14):
// - 殻の CSP — スクリプトは nonce の付いた /fence/map.web.js だけ
// - iframe の sandbox (allow-scripts だけ。同じ出所を与えない) — 図の中に何が
//   書かれていても、アプリの cookie・localStorage・鍵束には届かない

// 橋が触る iframe の部分。本番は HTMLIFrameElement、試験は偽物を渡す
export interface FenceGuiFrame {
  srcdoc: string;
  readonly contentWindow: {
    postMessage(message: unknown, targetOrigin: string): void;
  } | null;
  addEventListener(type: "load", listener: () => void): void;
  removeEventListener(type: "load", listener: () => void): void;
}

// 中から来る知らせを聞く相手。本番は window
export interface FenceGuiHost {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

export interface FenceGuiOptions {
  readonly frame: FenceGuiFrame;
  readonly host: FenceGuiHost;
  readonly editors: readonly FenceEditor[];
  // 開いたときの本文 (全文)
  readonly text: string;
  // 掴むフェンスの本文 1 行目 (0 始まり)
  readonly fenceLine: number;
  readonly scriptUri: string;
}

export interface FenceGuiHandle {
  // 殻が書き換えたあとの本文 (全文)
  readonly text: () => string;
  // 片付ける (聞き耳を外し、頁を空にする)
  readonly close: () => void;
}

// 中へ送るときの宛先。sandbox の頁の出所は不透明 ("null") で、名指しでは
// 届かない。送るのは本文から組んだ図の HTML だけで、受け手は自分の iframe
// (contentWindow) に固定されている
const TARGET_ORIGIN = "*";

// QR ノートにダークモードは無い。iframe の中には親の CSS が効かないので、
// 中の印 (<html data-theme="light">) で止める (上流 52 の docs/59 の決め 4)。
// 上流が案内する「load で contentDocument に書く」は sandbox では届かない
// (出所が違う) ので、**頁の頭に書いておく**。最初の描画から明るくもなる
function withLightTheme(html: string): string {
  return html.replace("<html ", '<html data-theme="light" ');
}

export function openFenceGui(options: FenceGuiOptions): FenceGuiHandle {
  const { frame, host, editors, scriptUri } = options;
  // 写しと、いま掴んでいるフェンス。殻が書き換え、閉じるときに読まれる
  let text = options.text;
  let fenceLine = options.fenceLine;

  // 中の頁ができるまでは送れないので、溜めておいて load で流す
  let ready = false;
  let waiting: readonly Outgoing[] = [];
  const send = (message: Outgoing): void => {
    frame.contentWindow?.postMessage(message, TARGET_ORIGIN);
  };
  const post = (message: Outgoing): void => {
    if (ready) {
      send(message);
      return;
    }
    waiting = [...waiting, message];
  };

  const session = createFenceGuiSession({
    editors,
    text: () => text,
    setText: (next) => {
      text = next;
    },
    fenceLine: () => fenceLine,
    // 殻の一覧で別の図を選び直したら、そちらを掴む
    onBind: (line) => {
      fenceLine = line;
    },
    post,
  });

  const onLoad = (): void => {
    ready = true;
    const pending = waiting;
    waiting = [];
    pending.forEach(send);
  };

  // **自分の iframe から来たものだけ聞く。** 頁には他にも postMessage の
  // 相手が居うる。中身の形は殻 (session.handle) が確かめる
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== frame.contentWindow) {
      return;
    }
    session.handle(event.data as Incoming).catch((error: unknown) => {
      // 殻の帯 (読めなかった行とお知らせ) に出す。黙って何も起きない形にしない
      post({
        kind: "notice",
        text: `操作を当てられませんでした: ${errorText(error)}`,
        bad: true,
      });
    });
  };

  frame.addEventListener("load", onLoad);
  host.addEventListener("message", onMessage);

  frame.srcdoc = withLightTheme(
    panelHtml({
      // 中の頁のスタイルは頁の中に書いてある (unsafe-inline)。sandbox で出所が
      // 不透明なので 'self' は何も指さないが、上流の頁の形に合わせて渡す
      cspSource: "'self'",
      nonce: makeNonce(),
      scriptUri,
      view: session.view(),
      // エディタの元に戻すは届かないので、殻に自前の履歴を持たせる
      undo: "own",
    }),
  );

  return {
    text: () => text,
    close: () => {
      frame.removeEventListener("load", onLoad);
      host.removeEventListener("message", onMessage);
      session.dispose();
      frame.srcdoc = "";
    },
  };
}
