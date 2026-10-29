// 書き込みの本体 (lib/commands) が投げる「利用者に見せてよい」失敗 (docs/123 §2)。
//
// status は route がそのまま HTTP の状態コードにする。これ以外の例外は
// 内部の失敗として 500 の定型文に畳み、中身はサーバのログにだけ残す
// (エラー文から内部の事情を漏らさない。security.md)
export class CommandError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'CommandError'
    this.status = status
  }
}
