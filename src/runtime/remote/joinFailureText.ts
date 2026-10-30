import type { JoinFailure } from '@/state';

export const JOIN_FAILURE_TEXT: Record<JoinFailure, string> = {
  'no-path': "Couldn't reach the other computer directly. Both must be on the same local network; guest Wi-Fi often blocks this.",
  'bad-code': 'That code is not valid.',
  'burnt': 'That code was already used. Ask for a new one.',
  'expired': 'That code has expired. Ask for a new one.',
  'rate-limited': 'Too many attempts. Try again in a minute.',
  'no-host': 'The other console is no longer sharing.',
  'busy': 'The device is in use by another console or temporarily unavailable.',
  'denied': 'The other console declined.',
  'host-gone': 'The other console stopped sharing.',
  'replaced': 'Connected from another tab.',
  'violation': 'The relay rejected the request.',
  'unreachable': 'Could not reach the relay.',
  'timeout': 'The other console did not respond.',
  'no-token': 'Nothing to reconnect to.',
  'sharing': "Stop sharing this console's device first.",
  'failed': 'Could not connect.',
};
