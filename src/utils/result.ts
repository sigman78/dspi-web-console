// `Result<T>` defaults `E` to `never`, so a function that can't fail
// idiomatically returns `Result<T>`.
export type Result<T, E = never> =
  | { ok: true; value: T }
  | { ok: false; code: E; message: string };

export function ok<T, E = never>(value: T): Result<T, E> {
  return { ok: true, value };
}

export function fail<E>(code: E, message: string): Result<never, E> {
  return { ok: false, code, message };
}
