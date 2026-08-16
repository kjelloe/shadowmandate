// engine/sensors.js — sensor beams across an approach (S16, M8 slice 8c).
//
// The first mechanism whose counter-play is PURE TIMING (D45). A camera can be
// walked behind; a beam has no behind — it is on, or it is off, on a fixed
// integer cycle, and the whole puzzle is the gap.
//
// WHAT A BEAM KNOWS, AND WHAT IT DOES NOT. A camera SEES you: it feeds the
// detection currency, so being caught on one makes you noticed and then burned.
// A beam only knows that SOMETHING crossed it. So it raises the facility's alarm
// and does not touch your detection state at all — you can trip a beam and still
// be unseen, which is a genuinely different texture and gives the player a real
// decision (trip it and hurry, or wait for the gap).
//
// Like cameras, beams are placed on the APPROACH rather than across the
// objective: a beam through the site cell would make the work itself impossible
// rather than the approach interesting, which is the mistake 8b made and paid
// for (see dev-log).
//
// A LEAF MODULE: imports nothing from the engine, so any module may use it.

// The cycle is a plain integer square wave. `onTicks` live, `offTicks` dark,
// `phase` staggering beams so a facility's beams do not blink as one — a
// synchronised set leaves a single global safe moment, which is a much weaker
// puzzle than several overlapping ones.
export function beamLiveAt(beam, tick) {
  if ((beam.disabledUntil | 0) > (tick | 0)) return false;
  const on = Math.max(0, beam.onTicks | 0);
  const off = Math.max(0, beam.offTicks | 0);
  const period = on + off;
  if (period <= 0) return true;          // a beam with no cycle is always live
  const t = ((Math.max(0, tick | 0) + (beam.phase | 0)) % period + period) % period;
  return t < on;
}

// How long until this beam next goes dark. Exported for the AI and for a future
// "wait for the gap" affordance — NOT for the view, which must never carry it
// or the timing puzzle is solved by reading the socket.
export function ticksUntilDark(beam, tick) {
  const on = Math.max(0, beam.onTicks | 0);
  const off = Math.max(0, beam.offTicks | 0);
  const period = on + off;
  if (period <= 0 || off === 0) return -1;         // never goes dark
  if (!beamLiveAt(beam, tick)) return 0;
  const t = ((Math.max(0, tick | 0) + (beam.phase | 0)) % period + period) % period;
  return on - t;
}

// The cells the beam occupies, endpoints included. Beams are axis-aligned or
// exactly diagonal so the cell list is exact in integers — a general line would
// need a rasteriser and would make "am I standing in it" arguable, which is
// precisely the thing a timing puzzle cannot afford to be.
export function beamCells(beam) {
  const cells = [];
  const dx = Math.sign((beam.toX | 0) - (beam.cellX | 0));
  const dy = Math.sign((beam.toY | 0) - (beam.cellY | 0));
  const steps = Math.max(
    Math.abs((beam.toX | 0) - (beam.cellX | 0)),
    Math.abs((beam.toY | 0) - (beam.cellY | 0)));
  for (let i = 0; i <= steps; i++) {
    cells.push({ x: (beam.cellX | 0) + dx * i, y: (beam.cellY | 0) + dy * i });
  }
  return cells;
}

export function beamCoversCell(beam, cellX, cellY) {
  return beamCells(beam).some((c) => c.x === cellX && c.y === cellY);
}

// Placement. Two emitters straddling the site's approach, at `standoff` cells
// out, so the beam crosses a path INTO the site rather than the site itself.
export function placeBeams(sites, rng, cfg, roll, size = 0) {
  const beams = [];
  if (!cfg || (cfg.sitePercent | 0) <= 0) return beams;
  const standoff = Math.max(1, cfg.standoff | 0);
  const half = Math.max(1, cfg.halfLength | 0);
  for (const site of sites) {
    if (roll(rng, 1, 100) > (cfg.sitePercent | 0)) continue;
    // Which side of the site the beam guards, and which way it runs across it.
    // A beam laid ALONG the approach would be walked around; laid ACROSS it, it
    // has to be timed. Horizontal offset -> vertical beam, and vice versa.
    const vertical = roll(rng, 0, 1) === 1;
    const side = roll(rng, 0, 1) === 1 ? 1 : -1;
    const ax = vertical ? site.cellX + side * standoff : site.cellX - half;
    const ay = vertical ? site.cellY - half : site.cellY + side * standoff;
    const bx = vertical ? ax : site.cellX + half;
    const by = vertical ? site.cellY + half : ay;
    if (size > 0 && [ax, bx].some((v) => v < 0 || v >= size)) continue;
    if (size > 0 && [ay, by].some((v) => v < 0 || v >= size)) continue;
    beams.push({
      id: beams.length,
      siteId: site.id,
      districtId: site.districtId,
      cellX: ax, cellY: ay, toX: bx, toY: by,
      onTicks: roll(rng, cfg.onMin | 0, cfg.onMax | 0),
      offTicks: roll(rng, cfg.offMin | 0, cfg.offMax | 0),
      phase: roll(rng, 0, 200),
      disabledUntil: 0,
    });
  }
  return beams;
}
