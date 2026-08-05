# Deploying Shadow Mandate to the sample host

Ports the pattern the two sibling projects have proven (multiciv, then
Fireline Command). The principles below are in the order they earned their
place; each one exists because its absence caused an outage somewhere.

1. **Allowlist rsync** — only what the server RUNS leaves the dev machine.
   The dev surface (`.claude/`, `debugging/`, `test/`, `specs/`, `reports/`,
   `tools/`, `dev-*.md`, `plan-*.md`) is never synced.
2. **Runtime state is never touched** — anything the box writes while live
   belongs to the box.
3. **One SSH connection** (ControlMaster mux) — one passphrase prompt, no
   rate-limited auth storms.
4. **Provenance guard** — the script deploys the WORKING TREE, so it prints
   branch / sha / dirty-count and stops for confirmation unless HEAD is a
   clean, pushed commit.
5. **Deploy guard** — after restart, `systemctl is-active` then `/health`.
   A crash-looping unit must fail the deploy loudly instead of printing
   success.
6. **Public verification** — curl the PUBLIC https endpoint too. The loopback
   check proves our process; only the public check proves nginx, TLS, and
   that no neighbour vhost hijacked the name.
7. **Shared-box sanity before restart** — `nginx -t`, port ownership, disk and
   RAM headroom. On a shared box, a neighbour's mistake becomes your outage.

## What the server is

One Node process, `server/index.js`: it serves the client over HTTP, the
world over a WebSocket at `/ws`, and two JSON endpoints. No build step, no
database, no bundler.

`three.js` is served from `node_modules` via `/vendor` and an importmap, so
**`npm ci` must run on the host** — there is no committed vendor tree and no
CDN. A deploy that skips it yields a blank diorama and no error, which is the
single most confusing failure this project has produced.

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP + WebSocket port |
| `SEED` | `4711` | world seed |
| `SIZE` | `64` | map edge in cells |
| `WORLD` | `sample` | world id |

## Endpoints, and what they actually prove

```
GET /health    → {ok, uptimeSec, ruleset, worlds:[{id, tick, seats, sleeping}]}
GET /version   → {ruleset, worlds}
WS  /ws        → the world
```

Two things about `/health` that the guard depends on:

- **`worlds` is empty on a fresh process.** Worlds are created lazily on first
  join, so a just-restarted server legitimately reports `"worlds": []`. The
  tick-advance check below therefore only applies once somebody has joined —
  do not write a guard that requires a moving tick on an empty box, because it
  will fail every clean deploy.
- **`sleeping: true` is healthy.** D16 parks an empty world so it costs
  nothing, and the sample host is empty most of the time. Treating dormancy as
  an outage would make the runbook cry wolf every quiet night.

So `/health` answering 200 with the expected `ruleset` proves the process
booted and loaded its rules. To prove the *pump*, poll twice with a world
that has seats and require `tick` to have moved.

## The runtime allowlist

```
client/***  engine/***  shared/***  server/***  data/***
package.json  package-lock.json  LICENSE
```

`data/` ships because it is the ruleset (`contracts.json`, `agents.json`,
`detection.json` …), not runtime state. Changing a number in there IS a
balance change and it goes through the pacing battery first — see
`debugging/analyze_pacing.py`.

## systemd unit (template)

```ini
# /etc/systemd/system/shadowmandate.service
[Unit]
Description=Shadow Mandate world server
After=network.target

[Service]
User=shadowmandate
WorkingDirectory=/opt/shadowmandate
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=3
Environment=PORT=8080
Environment=WORLD=sample
Environment=SEED=4711
Environment=SIZE=64

[Install]
WantedBy=multi-user.target
```

## Deploy sequence

```bash
# 1. provenance — refuse to deploy something you cannot name later
git status --short && git rev-parse --short HEAD

# 2. sync the allowlist only
rsync -az --delete \
  --include='client/***' --include='engine/***' --include='shared/***' \
  --include='server/***' --include='data/***' \
  --include='package.json' --include='package-lock.json' \
  --exclude='*' ./ host:/opt/shadowmandate/

# 3. dependencies ON THE HOST — /vendor serves three.js out of node_modules
ssh host 'cd /opt/shadowmandate && npm ci --omit=dev'

# 4. restart, then PROVE it
ssh host 'sudo systemctl restart shadowmandate && sleep 3 \
  && systemctl is-active shadowmandate \
  && curl -fsS http://127.0.0.1:8080/health'

# 5. public check — this is the one that proves nginx and TLS
curl -fsS https://<public-host>/health
```

## Before calling it deployed

Load the page in a real browser and drop in. Every client defect this project
has shipped was invisible to a green test suite and obvious within ten seconds
of a real page load: a CSS rule beating `[hidden]`, a fog range that painted
the whole scene in the clear colour, a board that rebuilt at 10 Hz and
destroyed its own buttons between mousedown and mouseup. `curl /health` cannot
see any of those.

## Not yet done

- No nginx site template committed here yet.
- No public listing / invite-only distinction (that is a V2 item).
- No automated deploy script; the sequence above is still run by hand.
