// `Result<T>` defaults `E` to `never`, so a function that can't fail
// idiomatically returns `Result<T>`. Factory functions live on the
// `Result` namespace (declaration-merged) so call sites read
// `Result.ok(value)` and `Result.fail('code', 'msg')`.
export type Result<T, E = never> =
  | { ok: true; value: T }
  | { ok: false; code: E; message: string };

export const Result = {
  ok<T, E = never>(value: T): Result<T, E> {
    return { ok: true, value };
  },
  fail<E>(code: E, message: string): Result<never, E> {
    return { ok: false, code, message };
  },
};
