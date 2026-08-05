#!/usr/bin/env python3
"""debugging/analyze_pacing.py — read a world-day CSV and verdict D11/D19.

Reports medians, not means: one runaway world-day should not move the verdict.
"""
import csv, statistics, sys

path = sys.argv[1] if len(sys.argv) > 1 else "reports/sweeps/pacing_local.csv"
rows = []
with open(path) as f:
    for line in f:
        if line.startswith("#"):
            print(line.rstrip()); continue
        rows.append(line)
data = list(csv.DictReader(rows))
num = lambda k: [int(r[k]) for r in data if r.get(k) not in (None, "")]

def med(xs): return statistics.median(xs) if xs else 0
mins = lambda ticks: ticks / 600.0        # 10 ticks/s, 60 s/min

sortie = [t for t in num("avgSortieTicks") if t > 0]
deploy = [t for t in num("avgDeployTicks") if t > 0]
tier3 = [n for n in num("deploysToTier3") if n > 0]

print(f"\nworld-days: {len(data)}")
print(f"{'':22}{'measured':>16}   {'D11/D19 target':>18}   verdict")
def line(label, value, lo, hi, unit=""):
    ok = lo <= value <= hi
    print(f"{label:22}{value:>13.1f}{unit:>3}   {lo:>7}-{hi:<10}{unit}   "
          f"{'IN BAND' if ok else ('LOW' if value < lo else 'HIGH')}")

line("sortie (AI)", mins(med(sortie)), 15, 20, "m")
line("deployment (AI)", mins(med(deploy)), 40, 60, "m")
line("deploys to tier 3", med(tier3), 3, 4, "")

# The AI never deliberates; a human is slower. Show the band that implies.
print(f"\nwith a 2-4x human deliberation factor:")
print(f"  sortie      {mins(med(sortie))*2:5.1f} - {mins(med(sortie))*4:5.1f} min   (target 15-20)")
print(f"  deployment  {mins(med(deploy))*2:5.1f} - {mins(med(deploy))*4:5.1f} min   (target 40-60)")

print(f"\ncontracts: completed median {med(num('completed'))}, "
      f"failed {med(num('failed'))}, expired {med(num('expired'))}")
print(f"burns median {med(num('burns'))}, captures {med(num('captures'))}, "
      f"clean extracts {med(num('cleanExtracts'))}")
kinds = ["courier", "surveillance", "extraction", "sabotage", "acquisition"]

# D19 asks whether a TYPE dominates. Completion-share alone cannot answer that:
# a short contract finishes more often per unit time than a long one no matter
# what anyone prefers, so extraction looks dominant even under perfectly equal
# choice. ACCEPTED share is what a Firm actually wanted; COMPLETED share is what
# the world let it finish. A type dominant in both is a balance problem; one
# dominant only in completions is a duration artefact, not a preference.
comp_total = sum(sum(num(k)) for k in kinds) or 1
off_total = sum(sum(num("off_" + k)) for k in kinds) or 0
acc_total = sum(sum(num("acc_" + k)) for k in kinds) or 0
print("\ncontract mix (D19 'no dominant type' check):")
if acc_total:
    hdr = f"  {'':14}{'offered':>9}{'accepted':>10}{'completed':>11}{'  preference':>13}"
    print(hdr)
    for k in kinds:
        acc = sum(num("acc_" + k)) / acc_total * 100
        comp = sum(num(k)) / comp_total * 100
        off = sum(num("off_" + k)) / off_total * 100 if off_total else 0
        # Preference controls for availability: 1.0x means a type is taken
        # exactly as often as it is put in front of somebody. THIS is the
        # number D19 is really asking about — raw share cannot distinguish
        # "players love it" from "it is one of the only three they can see".
        ratio = (acc / off) if off > 0.5 else None
        rtxt = f"{ratio:11.2f}x" if ratio is not None else f"{'—':>12}"
        flag = ""
        if ratio is not None and ratio >= 1.4:
            flag = "  <-- over-chosen"
        elif ratio is not None and ratio <= 0.6:
            flag = "  <-- ignored"
        print(f"  {k:14}{off:8.1f}%{acc:9.1f}%{comp:10.1f}%{rtxt}{flag}")
    print("\n  NOTE 1: tier gating bounds raw share. A Firm at tier 1 is only ever")
    print("  offered the three tier-1 types, so uniform choice among them is 33.3%")
    print("  each — already at D19's 35% ceiling. Read the preference column, not")
    print("  the raw percentages, when judging 'no dominant type'.")
    print("\n  NOTE 2: 'offered' samples board RESIDENCE every 600 ticks, and a")
    print("  popular contract leaves the board sooner precisely because it was")
    print("  taken. That biases its offered share DOWN and so overstates its")
    print("  preference ratio. Trust the direction and the ordering; do not read")
    print("  the multiplier as exact.")
else:
    print("  (no acceptance columns in this CSV — re-run the sweep to get them)")
    for k in kinds:
        share = sum(num(k)) / comp_total * 100
        flag = "  <-- dominant" if share > 35 else ""
        print(f"  {k:14}{share:5.1f}%{flag}")
