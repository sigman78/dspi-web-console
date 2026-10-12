// Test fixture: a reactive stand-in for the session mirror so a panel test can
// swap the snapshot (e.g. a device change) after mount.
export class ReactiveMirror<T> {
  current = $state<T>() as T;
  constructor(initial: T) { this.current = initial; }
}
