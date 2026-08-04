# Batch lane — gaming PC setup (Shadow Mandate)

The sim batteries do not run on the dev laptop. They run on the **Ryzen 5600X**,
driven by an agent-mail job queue. This is the Shadow Mandate lane; it shares
the *machine* with Fireline Command but not the *queue* (D25).

| | |
|---|---|
| Hub port | **8972** (multiciv owns 8970, firepower 8971) |
| Hub location | **this dev machine**, inside WSL |
| Worker location | gaming PC, WSL2, its own clone |
| Results channel | **mail only** — `reports/` is gitignored |

---

## 1. On THIS machine (dev laptop)

```bash
bash tools/hub_up.sh
```

Idempotent — run it after any WSL restart. It starts the hub and then verifies
the whole Windows path, printing the exact fix if anything is off.

**One-time, in an ADMIN PowerShell on this machine's Windows side:**

```powershell
netsh advfirewall firewall add rule name="shadow-mandate agent-mail hub" dir=in action=allow protocol=TCP localport=8972
netsh interface portproxy add v4tov4 listenport=8972 listenaddress=0.0.0.0 connectport=8972 connectaddress=<WSL-IP>
```

`hub_up.sh` prints the current WSL IP. **The firewall rule is one-time; the
portproxy is not** — the WSL IP changes on almost every reboot, and a stale
`connectaddress` black-holes every inbound connection silently. The worker
then sits in flag-wait forever with no error on either machine. `hub_up.sh`
detects exactly this and prints the two refresh lines. If the worker "can't
reach the hub", run it first and do what it says.

## 2. On the GAMING PC (WSL2)

```bash
git clone git@github.com:kjelloe/shadowmandate.git shadowmandate
cd shadowmandate && git checkout dev_night
node --version            # Node 20+ ; no other dependencies
npm install && npm test   # MUST be green — the worker refuses to serve on red

mkdir -p .agent-mail
echo "http://<dev-laptop-LAN-IP>:8972" > .agent-mail/remote

bash tools/batch_worker.sh            # sits in flag-wait, forever
# ONCE=1 bash tools/batch_worker.sh   # drain once (good first test)
# bash tools/batch_worker.sh -v       # narrate every decision
```

`npm install` pulls only `ws`; `shared/` and `engine/` have no dependencies at
all. No Playwright needed — there is no client yet, so **no GPU work exists for
this project**; the PC is doing pure CPU sim.

## 3. Queueing work (from the dev machine)

```bash
bash tools/batch_send.sh sweep 300      # balance census
bash tools/batch_send.sh mirror 300     # mirrored world: geometry vs doctrine
bash tools/batch_send.sh firmswap 300   # personalities trade seats
bash tools/batch_send.sh pacing 300     # D11/D19 columns
bash tools/batch_send.sh size128 100    # D26 capability battery
bash tools/batch_send.sh board          # who is doing what
bash tools/batch_send.sh collect        # pull results into reports/sweeps/
```

Worker maintenance: `update` (git pull + re-exec, autostash-safe), `resync`
(hard-reset to origin — safe here because the worker authors nothing and
results are gitignored), `sendresults` (re-mail everything on its disk).

## 4. The rules this lane encodes

- **A red suite means no service.** Results from a broken build are worse than
  no results, because they look like data.
- **Every result names its commit.** The CSV header carries ruleset era and
  `git describe`. A number without its era is void.
- **Failure is mailed as loudly as success.** Unparseable job bodies, dead
  shards, and red suites all mail home. A silent worker is a bug — check
  `reports/sweeps/worker.log`.
- **Results are never clobbered.** A differing file with the same label is
  shelved as `.prev` rather than overwritten.
- **Contention (D25):** the PC is shared with firepower. Run `board` in *both*
  repos before queueing anything large — both workers shard to every core, and
  two big batteries at once just makes both slow.
- **Never tune or convict on 5 seeds.** Batteries (n=300+) decide.

## 5. Verified before you set anything up

The whole lane was exercised on the dev machine: queue → worker → sharded run →
mail home → `collect` → `reports/sweeps/`, including the `.prev` shelving path.
Three CLI mismatches were found and fixed that way (`queue take` prints a header
line before the body; `inbox` has no `--json`; `send` takes `--from`/`--as`).
