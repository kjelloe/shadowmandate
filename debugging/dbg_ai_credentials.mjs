// debugging/dbg_ai_credentials.mjs — do AI firms actually BUY passes and
// wait for dark? (AI-1 census, kept.) The unit tests prove reachability;
// this probe shows live frequency, which is economics, not correctness —
// a seed with a poor firm buys nothing, honestly.
//   node debugging/dbg_ai_credentials.mjs <seed> <ticks>
process.chdir("/home/kjelloe/GIT/shadowmandate");
const { apply } = await import("/home/kjelloe/GIT/shadowmandate/engine/reducer.js");
const { createInitialState } = await import("/home/kjelloe/GIT/shadowmandate/engine/state.js");
const { generateCity } = await import("/home/kjelloe/GIT/shadowmandate/engine/citygen.js");
const { refillPool, rebuildOffers } = await import("/home/kjelloe/GIT/shadowmandate/engine/contracts.js");
const { spawnAiFirms, stepAiFirms } = await import("/home/kjelloe/GIT/shadowmandate/engine/ai_firms.js");
const { RULES } = await import("/home/kjelloe/GIT/shadowmandate/test/helpers.js");
const seed = Number(process.argv[2] ?? 1411), ticks = Number(process.argv[3] ?? 24000);
const city = generateCity(seed, 64, RULES.citygen);
let s = createInitialState({ seed, size: 64, rules: RULES, city });
spawnAiFirms(s, RULES, 3, {});
refillPool(s, RULES.contracts, RULES.detection);
rebuildOffers(s, RULES.contracts, RULES.detection);
const census = new Map();
let waited = 0;
for (let t = 0; t < ticks; t++) {
  const ai = stepAiFirms(s, RULES, apply);
  s = ai.state;
  s = apply(s, { type: 1 });
  for (const e of [...ai.events, ...s.events]) {
    census.set(e.type, (census.get(e.type) ?? 0) + 1);
    if (e.type === "aiDebug" && e.what === "waiting_for_dark") waited++;
    if (["dialogueChosen", "itemBought", "credentialGained"].includes(e.type)) {
      console.log(t, e.type, JSON.stringify(e).slice(0, 140));
    }
    if (e.type === "aiDebug" && ["buying_credential"].includes(e.what)) {
      console.log(t, "DBG", JSON.stringify(e).slice(0, 140));
    }
    if (e.type === "enteredBuilding" && (census.get("enteredBuilding") ?? 0) <= 3) {
      const a = s.agents[e.agentId];
      const b = s.agents[e.agentId] ? null : null;
      console.log(t, "entered", JSON.stringify(e).slice(0, 120), "insideId", a?.insideBuildingId);
    }
  }
}
const secured = new Set(s.sites.filter((x) => x.securityTier > 0).map((x) => x.id));
console.log("secured sites:", secured.size, "of", s.sites.length);
console.log("waiting_for_dark ticks:", waited);
for (const k of ["contractAccepted", "contractCompleted", "enteredBuilding", "exitedBuilding", "waitingForDark"]) {
  console.log(k, census.get(k) ?? 0);
}
