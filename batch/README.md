# The battery lane

Long simulation runs happen on a second machine, because a `pacing 300` sweep
shards across every core for minutes and a laptop is the wrong place for it.

**Git is the transport.** The dev machine commits a TASK and pushes; the worker
pulls, runs it, commits a RESPONSE and pushes back. Nothing is peer-to-peer, so
the worker can sit anywhere that can reach the remote — it replaced a LAN
agent-mail hub that had to be on the same network.

```
batch/tasks/0007-pacing.json      queued by the dev machine
batch/responses/0007-pacing.json  status, commit, era, row count
batch/responses/0007-pacing.csv   the data
```

A task with no response is pending. That is the whole protocol.

## Dev machine

```bash
node tools/batch.mjs queue pacing 300 60000   # n=300, 60k ticks
node tools/batch.mjs queue patrol 3 300       # patrol base 3, n=300
node tools/batch.mjs status                   # the board
git add batch/tasks && git commit -m "batch: queue pacing 300" && git push
```

## Worker

```bash
git pull
node tools/batch.mjs run          # or --dry to see what it would do
git add batch/responses && git commit -m "batch: results" && git push
```

Then read them:

```bash
node tools/batch.mjs status
python3 debugging/analyze_pacing.py batch/responses/0007-pacing.csv
```

## What the runner refuses to do

Every one of these was earned:

- **It will not serve on a red suite.** Results from a broken build are worse
  than no results, because they look like data. A red suite writes a FAILED
  response for every pending task rather than staying silent.
- **It names the commit and the era in every result.** A stale worker produced
  confusing verdicts for a day before anyone checked what it was running.
  `sm_worldday` already stamps both into the CSV header; the response repeats
  them so a directory listing answers the question without opening a file.
- **It flags an era mismatch rather than correcting it.** A battery that ran on
  a different era than it was queued for is not wrong — it answers a different
  question, and reading it as the old one is the stale-baseline hazard the era
  discipline exists for.
- **It refuses empty output.** A shard that dies silently would otherwise merge
  into a cheerful "0 rows".
- **It writes nothing private.** These files are tracked and this remote is
  public, so the runner records no hostname and no user, and scrubs absolute
  paths out of any captured error. `ops/` stays gitignored for everything that
  genuinely is machine-specific.

## One worker at a time

The protocol has no claim step: two workers pulling the same pending task would
both run it and race to push. That is fine to fix if it ever matters (a `claim`
file would do it), but with one machine it is complexity for nothing.

## Contention (D25)

The PC is shared with the sibling project. Check `status` in BOTH repos before
queueing anything large — both workers shard to every core.
