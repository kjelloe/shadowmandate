// engine/commands.js — the command vocabulary and its validator.
//
// Commands are compact typed intent. The server sets the execution tick and
// order; the reducer never reads a clock. The ONLY command carrying wall time
// is DORMANCY_TICK.elapsedMs (D16) — the single sanctioned clock entry point.

export const CMD_ADVANCE_TICK = 1;

// Session loop (S05)
export const CMD_DROP_IN = 10;
export const CMD_ACTIVATE_EVAC = 11;
export const CMD_CANCEL_EVAC = 12;
export const CMD_EXTRACT = 13;

// Agent control (S02)
export const CMD_MOVE = 20;
export const CMD_SET_STANCE = 21;
export const CMD_ENTER_VEHICLE = 22;
export const CMD_EXIT_VEHICLE = 23;

// Interaction (S04, S06, S09)
export const CMD_USE_ITEM = 30;
export const CMD_RESCUE = 31;
export const CMD_CAPTURE = 32;
export const CMD_PAY_BAIL = 33;
export const CMD_ENTER_BUILDING = 34;
export const CMD_EXIT_BUILDING = 35;
export const CMD_DIALOGUE_CHOICE = 36;
export const CMD_BUY_ITEM = 37;

// Contracts (S06)
export const CMD_ACCEPT_CONTRACT = 40;
export const CMD_ABANDON_CONTRACT = 41;
export const CMD_SITE_ACTION = 42;   // plant / crack / hold — type-specific
// S16 8d. The counter-play to cameras and beams, and DIEGETIC per D45: you walk
// to the junction box and cut it, in the world, in time — no modal panel.
export const CMD_CUT_JUNCTION = 43;
// S16 8k. The third credential source (8e) shipped with a function, tests, and
// NO COMMAND — so lifting a badge off a disabled guard did not exist in the
// game for anyone. This is the missing half.
export const CMD_LIFT_CREDENTIAL = 44;

// Encounters (S08)
export const CMD_STANDOFF_CHOICE = 50;

// World lifecycle (S10)
export const CMD_DORMANCY_TICK = 60;

const INT = (v) => Number.isInteger(v);

// Validation is an allowlist: an unknown type or a malformed field is rejected
// before the reducer sees it. Server-side frames are validated again at the
// transport boundary (S11).
export function validate(command) {
  if (!command || typeof command !== "object") return false;
  if (!INT(command.type)) return false;
  switch (command.type) {
    case CMD_ADVANCE_TICK:
      return true;
    case CMD_DROP_IN:
      return INT(command.firmId) && INT(command.cellX) && INT(command.cellY);
    case CMD_ACTIVATE_EVAC:
    case CMD_CANCEL_EVAC:
    case CMD_EXTRACT:
      return INT(command.firmId);
    case CMD_MOVE:
      return INT(command.agentId) && INT(command.cellX) && INT(command.cellY);
    case CMD_SET_STANCE:
      return INT(command.agentId) && INT(command.stance)
        && command.stance >= 0 && command.stance <= 2;
    case CMD_ENTER_VEHICLE:
    case CMD_EXIT_VEHICLE:
      return INT(command.agentId);
    case CMD_USE_ITEM:
      return INT(command.agentId) && INT(command.slot)
        && INT(command.cellX) && INT(command.cellY);
    case CMD_CUT_JUNCTION:
      return INT(command.agentId) && INT(command.junctionId);
    case CMD_LIFT_CREDENTIAL:
      return INT(command.agentId) && INT(command.patrolId);
    case CMD_RESCUE:
    case CMD_CAPTURE:
      return INT(command.agentId) && INT(command.targetAgentId);
    case CMD_PAY_BAIL:
      return INT(command.firmId) && INT(command.agentId);
    case CMD_ENTER_BUILDING:
    case CMD_EXIT_BUILDING:
      return INT(command.agentId);
    case CMD_DIALOGUE_CHOICE:
      return INT(command.agentId) && INT(command.optionIdx);
    case CMD_BUY_ITEM:
      return INT(command.agentId) && INT(command.itemIdx);
    case CMD_ACCEPT_CONTRACT:
    case CMD_ABANDON_CONTRACT:
      return INT(command.agentId) && INT(command.contractId);
    case CMD_SITE_ACTION:
      return INT(command.agentId) && INT(command.siteId);
    case CMD_STANDOFF_CHOICE:
      return INT(command.agentId) && INT(command.standoffId)
        && INT(command.choice) && command.choice >= 0 && command.choice <= 2;
    case CMD_DORMANCY_TICK:
      // Note the bound: a 28-day season is ~2.4e9 ms, past i32. Validate as a
      // safe integer, never by narrowing.
      return INT(command.elapsedMs) && command.elapsedMs >= 0
        && command.elapsedMs <= Number.MAX_SAFE_INTEGER;
    default:
      return false;
  }
}

// Human-readable names, for events, probes and telemetry.
export const COMMAND_NAMES = Object.freeze({
  [CMD_ADVANCE_TICK]: "advanceTick",
  [CMD_DROP_IN]: "dropIn",
  [CMD_ACTIVATE_EVAC]: "activateEvac",
  [CMD_CANCEL_EVAC]: "cancelEvac",
  [CMD_EXTRACT]: "extract",
  [CMD_MOVE]: "move",
  [CMD_SET_STANCE]: "setStance",
  [CMD_ENTER_VEHICLE]: "enterVehicle",
  [CMD_EXIT_VEHICLE]: "exitVehicle",
  [CMD_USE_ITEM]: "useItem",
  [CMD_RESCUE]: "rescue",
  [CMD_CAPTURE]: "capture",
  [CMD_PAY_BAIL]: "payBail",
  [CMD_ENTER_BUILDING]: "enterBuilding",
  [CMD_EXIT_BUILDING]: "exitBuilding",
  [CMD_DIALOGUE_CHOICE]: "dialogueChoice",
  [CMD_BUY_ITEM]: "buyItem",
  [CMD_ACCEPT_CONTRACT]: "acceptContract",
  [CMD_ABANDON_CONTRACT]: "abandonContract",
  [CMD_SITE_ACTION]: "siteAction",
  [CMD_STANDOFF_CHOICE]: "standoffChoice",
  [CMD_DORMANCY_TICK]: "dormancyTick",
});
