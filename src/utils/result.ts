// `Result<T>` defaults `E` to `never`, so a function that can't fail
// idiomatically returns `Result<T>`. Factory functions live on the
// `Result` namespace (declaration-merged) so call sites read
// `Result.ok(value)` and `Result.fail('code', 'msg')`.
export type Result<T, E = never> =
  | { ok: true; value: T }
  | { ok: false; code: E; message: string };

export const Result = {
  // `T` defaults to `void` so a success that carries no value is written
  // `Result.ok()` rather than the smelly `Result.ok(undefined)`. Callers that
  // pass a value still infer `T` from the argument as before.
  ok<T = void, E = never>(value?: T): Result<T, E> {
    return { ok: true, value: value as T };
  },
  fail<E>(code: E, message: string): Result<never, E> {
    return { ok: false, code, message };
  },
};

// A Result whose success path carries no value — the common shape for
// "do this side-effecting thing, report a typed failure". Defaults the error
// channel to `string` (the UI-facing action wrappers), but takes a typed code
// for device/protocol layers, e.g. `VoidResult<FlashResult>`.
export type VoidResult<E = string> = Result<void, E>;
