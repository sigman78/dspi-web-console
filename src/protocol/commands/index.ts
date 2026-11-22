import { SysCmd, SysAct } from './sys';
import { StoreCmd, StoreAct } from './store';
import { InputCmd, InputAct } from './input';
import { OutputCmd, OutputAct } from './output';
import { RouteCmd, RouteAct } from './route';
import { FilterCmd } from './filter';
import { DynCmd } from './dyn';
import { FxCmd } from './fx';
import { MeasCmd, MeasAct } from './meas';
import { CsCmd, CsAct } from './cs';
import { XportCmd } from './xport';
import { ClockCmd, ClockAct } from './clock';

export const Cmd = {
  ...SysCmd,
  ...StoreCmd,
  ...InputCmd,
  ...OutputCmd,
  ...RouteCmd,
  ...FilterCmd,
  ...DynCmd,
  ...FxCmd,
  ...MeasCmd,
  ...CsCmd,
  ...XportCmd,
  ...ClockCmd,
} as const;

export const Act = {
  ...SysAct,
  ...StoreAct,
  ...InputAct,
  ...OutputAct,
  ...RouteAct,
  ...MeasAct,
  ...CsAct,
  ...ClockAct,
} as const;

export * from './types';
export * from './exec';
