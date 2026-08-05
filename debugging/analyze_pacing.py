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
total = sum(sum(num(k)) for k in kinds) or 1
print("\ncontract mix (D19 'no dominant type' check):")
for k in kinds:
    share = sum(num(k)) / total * 100
    flag = "  <-- dominant" if share > 35 else ""
    print(f"  {k:14}{share:5.1f}%{flag}")
