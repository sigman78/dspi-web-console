// True from page load until the first auto-connect attempt settles. The shell
// uses it to hold a quiet splash (instead of the connect hero) while a returning
// user's device auto-connects and its snapshot loads -- so the UI appears once,
// fully populated, rather than flashing hero -> empty UI -> filled UI.
let _initialBoot = $state(true);

export const initialBoot = {
  get active(): boolean { return _initialBoot; },
};

export function endInitialBoot(): void {
  _initialBoot = false;
}
