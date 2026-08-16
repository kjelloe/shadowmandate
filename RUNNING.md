# Running Shadow Mandate

```bash
npm install          # one dependency: ws
npm test             # 171 tests
npm start            # http://localhost:8080
```

Environment: `PORT` (8080), `SEED` (4711), `SIZE` (64 or 128), `WORLD` (sample).

```bash
PORT=8099 SEED=90210 SIZE=128 npm start
```

## What you get

A seeded city, 3 AI rival Firms already working it, and a seat of your own. The
splash shows the world's state; **Drop In** puts you on the map.

- **Tap** to move · **double-tap** to hurry (louder, more visible)
- Stance chips: Sneak / Move / Hurry — cover plus Sneak is what actually
  defeats a patrol, not stance alone
- **CONTRACTS** opens your five offers (yours alone — D18)
- **EVAC** raises the beacon; hold the HQ for 30 seconds

Your **recovery code** is shown once on first connection. Write it down: the
server keeps only a hash, and it is the only way back to your Firm from another
browser (D10/D32).

## Inspecting a world without playing

```bash
node tools/render_city.mjs 4711 64        # the city as ASCII
SEED=4711 node debugging/sm_systems.mjs   # what actually fires in a run
node tools/sm_worldday.mjs 12             # AI world-day metrics as CSV
```

## Known state

The renderer is a **2D top-down canvas**, not the three.js 2.5D diorama the
design specifies (S12). That is a deliberate staging decision: the renderer is
non-authoritative and every model module is renderer-agnostic, so the swap is
contained — and a loop you can feel now is worth more than a prettier one
later. No art assets yet; everything is drawn as coloured primitives.
