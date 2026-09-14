// ログ 1 件の形と上限 (設計は docs/21-ログ表示計画.md / docs/30-ブラウザログ計画.md)。
//
// サーバ側の控え (logging/buffer.ts) とブラウザ側の拾い手 (logging/clientCapture.ts) の
// 両方が使うので、状態を持たないここに置く。logging/buffer.ts に置くと、console を
// 包む処理まるごとがクライアントのバンドルに載る。

// info は診断イベント (logging/diagLog.ts) 用。console は包まず、明示的に送った
// ものだけがこのレベルになる (warn/error の「失敗の印」を薄めないため)
export type LogLevel = 'info' | 'warn' | 'error'

// どこで起きたログか。/logs はバッジで見分けを付ける
export type LogSource = 'server' | 'browser'

export interface LogEntry {
  // epoch ms。表示のときに Asia/Tokyo で整形する (サーバの TZ に依存させない)。
  // ブラウザ由来のものも**サーバが受け取った時刻**を使う。クライアントの
  // 時計は信じない (ずれ・改ざんを考えなくて済む。数秒の誤差は診断に効かない)
  at: number
  level: LogLevel
  text: string
  source: LogSource
  // ブラウザ由来のときだけ付く端末の印 (iPhone / Android / PC)。
  // 複数端末で使うので「どの端末の悲鳴か」が要る
  device?: string
}

// source ごとに 200 件ずつ。混ぜると多弁な側が寡黙な側を押し流す
// (クライアントの暴走ループがサーバの肝心の 1 行を消す)
export const LOG_BUFFER_SIZE = 200
export const LOG_TEXT_LIMIT = 2000
