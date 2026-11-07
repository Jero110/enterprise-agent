/** An error that is safe to show to the caller: a status, a stable code and a plain-language message. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
