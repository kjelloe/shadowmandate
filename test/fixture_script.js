// test/fixture_script.js — THE pinned command script, shared by the fixture
// test and the re-pin tool so they can never disagree about what is pinned.
//
// Rules for changing this script (S14):
//  - Adding steps at the END is cheap; a re-pin records the new tail.
//  - Changing or reordering EXISTING steps invalidates the era. Don't, unless
//    a ruling requires it, and say so in the re-pin reason.
//  - A NEW EVENT appearing inside these steps is DRIFT: the reducer is wrong,
//    not the fixture. Prefer silent state changes for routine per-tick work.

import { CMD_ADVANCE_TICK, CMD_SET_STANCE } from "../engine/commands.js";
import { STANCE_SNEAK, STANCE_HURRY } from "../engine/state.js";

export const FIXTURE_SEED = 20260804;
export const FIXTURE_SIZE = 64;

export const FIXTURE_SCRIPT = [
  { type: CMD_ADVANCE_TICK },
  { type: CMD_ADVANCE_TICK },
  { type: CMD_ADVANCE_TICK },
  // A rejected command must be inert beyond its event — pinned on purpose.
  { type: CMD_SET_STANCE, agentId: 0, stance: STANCE_SNEAK },
  { type: CMD_ADVANCE_TICK },
  { type: CMD_ADVANCE_TICK },
  { type: CMD_SET_STANCE, agentId: 63, stance: STANCE_HURRY },
  { type: CMD_ADVANCE_TICK },
  { type: CMD_ADVANCE_TICK },
  { type: CMD_ADVANCE_TICK },
  { type: CMD_ADVANCE_TICK },
  { type: CMD_ADVANCE_TICK },
  { type: CMD_ADVANCE_TICK },
  { type: CMD_ADVANCE_TICK },
];
