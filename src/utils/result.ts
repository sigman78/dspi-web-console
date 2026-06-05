// `E` defaults to `never` so an infallible function returns `Result<T>`.
// Factories live on the declaration-merged `Result` namespace.
export type Result<T, E = never> =
  | { ok: true; value: T }
  | { ok: false; code: E; message: string };

export const Result = {
  // `T` defaults to `void` so a no-value success is `Result.ok()`, not
  // `Result.ok(undefined)`; a passed value still infers `T`.
  ok<T = void, E = never>(value?: T): Result<T, E> {
    return { ok: true, value: value as T };
  },
  fail<E>(code: E, message: string): Result<never, E> {
    return { ok: false, code, message };
  },
};

// A Result whose success path carries no value -- the common shape for
// "do this side-effecting thing, report a typed failure". Defaults the error
// channel to `string` (the UI-facing action wrappers), but takes a typed code
// for device/protocol layers, e.g. `VoidResult<FlashResult>`.
export type VoidResult<E = string> = Result<void, E>;
