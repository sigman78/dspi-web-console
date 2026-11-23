// Lookups over the generated paged command registry (paged.gen.ts).

import { PagedCmd, type PagedCommand } from './paged.gen';

export interface NamedPagedCommand extends PagedCommand {
  // PAGE.NAME, as the firmware registry and legacy_map spell it.
  readonly name: string;
}

const BY_ID = new Map<number, NamedPagedCommand>();
for (const [page, commands] of Object.entries(PagedCmd)) {
  for (const [name, cmd] of Object.entries(commands)) BY_ID.set(cmd.id, { ...cmd, name: `${page}.${name}` });
}

export function pagedCommand(id: number): NamedPagedCommand | undefined {
  return BY_ID.get(id);
}

// Paged GETs are IN transfers and SETs (actions included) are OUT; there is
// no write-as-read on the paged protocol.
export function hasPaged(id: number, dir: 'in' | 'out'): boolean {
  const cmd = BY_ID.get(id);
  return cmd !== undefined && (dir === 'in' ? cmd.get : cmd.set);
}
