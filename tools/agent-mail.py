#!/usr/bin/env python3
"""Tiny file-backed mailbox for the architect and any number of coder agents.

Replaces the free-form agent-chat.md for day-to-day signaling: addressed
messages, per-recipient unread tracking, no rereading a growing file.
Storage: .agent-mail/messages.jsonl (append-only) + one cursor file per
reader (no shared writes, so parallel agents can't clobber each other).

  python3 tools/agent-mail.py send --from architect --to helper "A11 is a go"
  python3 tools/agent-mail.py send --from helper --to architect "A11 done" --tag done
  python3 tools/agent-mail.py inbox --as helper          # unread for me (DELIVERS; ack after)
  python3 tools/agent-mail.py ack @a1b2c3d4 --as helper  # settle it (else it comes back)
  python3 tools/agent-mail.py peek --as helper           # unread, without marking
  python3 tools/agent-mail.py log [-n 20]                # recent traffic, all parties
  python3 tools/agent-mail.py who                        # known roles + unread counts

Conventions: roles are free-form (architect, helper, helper2...); --to all
broadcasts; multi-line bodies via stdin: `... send --from x --to y -` reads
the body from stdin. Tags (--tag done|question|fyi|claim) make filtering
easy: `inbox --as architect --tag done`.

Forgiving flags (agents guess these; all accepted): the identity flag is
--from/--as/--role/--sender interchangeably on every command that takes
one; the send body may be positional OR --body/--text/--message/-m;
lock's --why also answers to --reason.

Every message has a GLOBAL id hash (8 hex chars, derived from its content,
identical for every reader) shown next to the sequence number — refer to
messages by hash across inboxes and sessions; `show <hash-prefix>` prints
the full message.

TERRITORY + LEASES: a lane OWNS a set of globs (tools/owners) and edits
inside them freely, no lock. A lock is a time-limited LEASE on someone
else's ground or on unowned ground, and it mails the owner automatically:

  python3 tools/agent-mail.py territory --check          # clashes + unowned files
  python3 tools/agent-mail.py owner path/x.js --as helper # may I just edit this?

FILE LOCKS (the claim protocol, made mechanical — a mail claim carries the
WHY; the lock registry answers "may I edit this file RIGHT NOW"):

  python3 tools/agent-mail.py lock client/main.js --as helper --why "A28 e2e block"
  python3 tools/agent-mail.py locks                    # who holds what, with age
  python3 tools/agent-mail.py unlock client/main.js --as helper
  python3 tools/agent-mail.py unlock client/main.js --as architect --force

Rules: check `locks` BEFORE editing any shared file (client/, server/,
shared/, test/browser.test.js); lock what you edit, unlock in your
done-mail step. A lock held by someone else = mail them or the architect —
never edit through it. Only the holder (or the architect with --force,
which logs a broadcast) may unlock. Locks are advisory-but-mandatory
convention; stale ones (see age) get arbitrated, not ignored.

MAILBOX FLAG (the 10-minute poll, 2026-07-21): one cheap line that answers
"is there anything for me?" — unread mail, queued work, or a manually
raised note — like the raised flag on a mailbox:

  python3 tools/agent-mail.py flag --as helper          # check; poll this at least every 10 min
  python3 tools/agent-mail.py flag wait --as helper     # BLOCKING check — the idle-lane loop (below)
  python3 tools/agent-mail.py flag raise --for helper --as architect --why "re-read spec X"
  python3 tools/agent-mail.py flag lower --as helper    # after acting on the note

Discipline: EVERY lane checks its flag at least every 10 minutes — between
test runs, during long ops, and ESPECIALLY while in a waiting pattern
(waiting is not exemption; it is the main case). FLAG UP names the next
command to run (inbox / queue take / flag lower). Unread mail and queue
depth clear themselves when consumed; only the manual note needs an
explicit `flag lower`. `flag raise` is for "new work/update" signals that
have no new mail behind them (a spec changed, a ruling landed in a file, a
parked lane should resume); a worker that needs the coordinator NOW may
raise the coordinator's flag (`flag raise --for coordinator --as <role>
--why "see status board"`) — the one outbound signal workers keep.

THE IDLE-LANE LISTENING LOOP (`flag wait`, 2026-07-22): an agent session
only executes while it has a live turn — a lane that ends its turn
"waiting" cannot poll anything, which is why updates sat unseen until a
human nudge. `flag wait --as <role>` fixes that mechanically: it BLOCKS
until the flag is up (mail/queue/note), else returns after --timeout
(default 540s, sized under a 600s shell-tool cap). The waiting ritual:
instead of ending your turn, run `flag wait`; on FLAG UP act on what it
names; on "still down" run `flag wait` again. Long ops: run them in the
background and `flag wait` in the foreground. The loop runs client-side
(one cheap check per --interval, default 15s), so it is hub-safe and
identical on remote clones.

LAN HUB (cross-machine mail + locks, 2026-07-14): the dev PC runs
`agent-mail.py serve [--port 8970] [--host 0.0.0.0]` — a tiny HTTP hub
over the same .agent-mail/ store. Any other clone on the LAN writes the
hub's URL into `.agent-mail/remote` (one line, e.g.
http://192.168.1.116:8970) and EVERY agent-mail command there proxies
transparently: same commands, same output, one shared mailbox and ONE
shared lock registry across machines. Trusted-LAN posture (no auth —
same stance as the game server); delete the remote file to go local.
"""
import argparse
import hashlib
import hmac
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOX = os.path.join(ROOT, '.agent-mail')
LOG = os.path.join(BOX, 'messages.jsonl')
LOCKS = os.path.join(BOX, 'locks.json')
ALIASES = os.path.join(BOX, 'roles')

_ALIAS_CACHE = None


def load_aliases():
    # Role aliases: an editable map so a coordination ROLE can be re-pointed
    # without touching specs or code. Format: "alias = canonical" per line
    # ('#' comments; ':' also accepted). Read-time + additive — `--to
    # coordinator` reaches whoever `coordinator` resolves to; `--to architect`
    # is unaffected. Cached per process: a local CLI reloads every call (instant
    # re-point); the long-lived `serve` hub reloads on restart (like any
    # agent-mail.py change), so remote lanes see a re-point after a hub restart.
    global _ALIAS_CACHE
    if _ALIAS_CACHE is not None:
        return _ALIAS_CACHE
    out = {}
    try:
        with open(ALIASES, encoding='utf-8') as f:
            for line in f:
                line = line.split('#', 1)[0].strip()
                if not line:
                    continue
                sep = '=' if '=' in line else (':' if ':' in line else None)
                if not sep:
                    continue
                alias, target = (p.strip() for p in line.split(sep, 1))
                if alias and target:
                    out[alias] = target
    except FileNotFoundError:
        pass
    _ALIAS_CACHE = out
    return out


def canon(role):
    # Resolve an alias to its canonical role (one hop — a canonical must be a
    # real role, never another alias). Unknown/non-alias roles map to themselves.
    return load_aliases().get(role, role)


def addressed(to_field, role):
    # Does a message addressed to `to_field` reach `role`? 'all' broadcasts;
    # otherwise match on the CANONICAL role so aliases deliver into the
    # canonical inbox (coordinator→architect matches a query as either name).
    if to_field == 'all':
        return True
    c = canon(role)
    return any(canon(r) == c for r in recipients(to_field))


# --- ownership map (declared territory, so locks become the EXCEPTION) ---
# Roles split by activity (build / harden / review / debug) all touch every
# file, which is why the lock registry had to carry so much weight. Roles
# split by TERRITORY barely collide. A lane owns a SET of globs; inside its
# set it edits freely with no lock at all. A lock is now what it should
# always have been: a short borrow of someone else's ground, or a claim on
# land nobody owns.
#
# .agent-mail/owners  — one lane per line, comma-separated globs:
#   helper         = server/**, shared/util/**
#   roblox-builder = client/**, place/*.rbxlx
#   simulator      = world/**, maps/**, data/seeds/*.json
# '**' crosses directories, '*' does not. Longest matching pattern wins, so
# a narrow rule overrides a broad one. Unlisted paths are UNOWNED: those are
# exactly the files the lock protocol is for.
# The manifest is POLICY, not runtime state: who may edit what is a design
# decision that should be diffable, reviewable and revertable. .agent-mail/ is
# gitignored (correctly — cursors, locks and flags are per-machine noise), so
# the manifest lives in tracked ground and only falls back to the old location.
OWNERS = os.path.join(ROOT, 'tools', 'owners')
if not os.path.exists(OWNERS):
    OWNERS = os.path.join(BOX, 'owners')
_OWNER_CACHE = None


def glob_to_re(pat):
    import re
    out, i = [], 0
    while i < len(pat):
        c = pat[i]
        if pat.startswith('**', i):
            out.append('.*')
            i += 2
            if pat.startswith('/', i):   # 'a/**/b' should also match 'a/b'
                out.append('/?')
                i += 1
        elif c == '*':
            out.append('[^/]*')
            i += 1
        elif c == '?':
            out.append('[^/]')
            i += 1
        else:
            out.append(re.escape(c))
            i += 1
    return re.compile('^' + ''.join(out) + '$')


def load_owners():
    global _OWNER_CACHE
    if _OWNER_CACHE is not None:
        return _OWNER_CACHE
    out = {}
    last = None
    try:
        with open(OWNERS, encoding='utf-8') as f:
            for raw in f:
                line = raw.split('#', 1)[0].rstrip()
                if not line.strip():
                    continue
                sep = '=' if '=' in line else (':' if ':' in line else None)
                if sep is None:
                    # an indented continuation of the previous lane, so a long
                    # ignore list can wrap instead of living on one huge line
                    if last and raw[:1].isspace():
                        pl = [p.strip().replace(os.sep, '/')
                              for p in line.split(',') if p.strip()]
                        out.setdefault(last, []).extend(pl)
                    continue
                lane, pats = (p.strip() for p in line.split(sep, 1))
                pl = [p.strip().replace(os.sep, '/') for p in pats.split(',') if p.strip()]
                if lane:
                    last = canon(lane)
                    out.setdefault(last, []).extend(pl)
    except FileNotFoundError:
        pass
    _OWNER_CACHE = out
    return out


def is_ignored(path):
    key = norm_path(path)
    return any(glob_to_re(p).match(key) for p in load_owners().get('ignore', []))


def owner_of(path):
    # (lane, pattern) for the most specific match, else (None, None)
    key = norm_path(path)
    best = (None, None)
    for lane, pats in load_owners().items():
        if lane == 'ignore':
            continue
        for p in pats:
            if glob_to_re(p).match(key) and len(p) > len(best[1] or ''):
                best = (lane, p)
    return best


def owns(role, path):
    lane, _ = owner_of(path)
    return lane is not None and lane == canon(role)


def read_locks():
    try:
        with open(LOCKS, encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def write_locks(locks):
    tmp = LOCKS + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(locks, f, indent=1)
    os.replace(tmp, LOCKS)


# A lock is a LEASE, not a deed. A lane whose PC sleeps, whose session is
# cleared, or who simply forgets its done-mail step used to hold a file
# forever and only a human with --force could free it. A lease expires on
# its own; the holder keeps it alive by re-running `lock` (which renews).
LOCK_TTL_MIN = 45


def lock_expired(held, now=None):
    now = now or int(time.time())
    return (now - held['ts']) > held.get('ttl', LOCK_TTL_MIN) * 60


def norm_path(path):
    # registry keys are repo-relative with forward slashes — the same file
    # must hash to the same key no matter how the caller spelled it
    ap = os.path.abspath(os.path.join(ROOT, path)) if not os.path.isabs(path) else path
    return os.path.relpath(ap, ROOT).replace(os.sep, '/')


def age_str(ts):
    mins = int((time.time() - ts) / 60)
    return f'{mins}m' if mins < 120 else f'{mins // 60}h{mins % 60:02d}m'


def read_all():
    if not os.path.exists(LOG):
        return []
    out = []
    with open(LOG, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return out


def msg_hash(m):
    # content-derived: every reader computes the same hash, no migration
    # needed for old messages, and racing senders that collide on the
    # sequential id still get distinct hashes
    key = f"{m.get('id')}|{m.get('ts')}|{m.get('from')}|{m.get('to')}|{m.get('text')}"
    return hashlib.sha256(key.encode('utf-8')).hexdigest()[:8]


def cursor_file(role):
    # canonical so an alias and its target share ONE cursor (no double-reads)
    return os.path.join(BOX, f'cursor-{canon(role)}')


def get_cursor(role):
    try:
        with open(cursor_file(role)) as f:
            return int(f.read().strip() or 0)
    except (FileNotFoundError, ValueError):
        return 0


def set_cursor(role, value):
    with open(cursor_file(role), 'w') as f:
        f.write(str(value))


# --- delivery state: at-least-once mail ---------------------------------
# The cursor alone was AT-MOST-once: `inbox` advanced it past everything
# unread, so (a) a --tag filtered read silently buried the messages it did
# not print, and (b) a lane that read its mail and then lost its turn --
# context compaction, crash, human interrupt -- never saw that mail again.
# Now: `inbox` DELIVERS (marks pending, prints); `ack` SETTLES. The cursor
# advances only over a contiguous run of settled ids, so nothing is ever
# stepped over. A delivered-but-unacked message returns to the inbox after
# REDELIVER_SEC -- the lane gets a second chance without a human nudge.
REDELIVER_SEC = 900


def pending_file(role):
    return os.path.join(BOX, f'pending-{canon(role)}')


def acked_file(role):
    return os.path.join(BOX, f'acked-{canon(role)}')


def _read_json(path, empty):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return empty


def _write_json(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, path)


def read_pending(role):
    return _read_json(pending_file(role), {})


def read_acked(role):
    return set(_read_json(acked_file(role), []))


def deliver(role, msgs):
    # mark printed messages as in-flight; redelivery timer starts now
    pend = read_pending(role)
    now = int(time.time())
    for m in msgs:
        pend[str(m['id'])] = now
    _write_json(pending_file(role), pend)


def settle(role, ids):
    # ack: drop from pending, add to acked, then slide the cursor over the
    # contiguous settled run and prune everything below it.
    pend = read_pending(role)
    acked = read_acked(role)
    for i in ids:
        pend.pop(str(i), None)
        acked.add(int(i))
    cur = get_cursor(role)
    c = canon(role)
    mine = sorted(m['id'] for m in read_all()
                  if m['id'] > cur and addressed(m['to'], role) and canon(m['from']) != c)
    for mid in mine:
        if mid in acked:
            cur = mid
        else:
            break
    acked = {i for i in acked if i > cur}
    pend = {k: v for k, v in pend.items() if int(k) > cur}
    set_cursor(role, cur)
    _write_json(acked_file(role), sorted(acked))
    _write_json(pending_file(role), pend)
    return cur


def recipients(to_field):
    # a message's `to` may be a comma-joined list ("architect,sim-runner");
    # split it so each named role matches, not just the exact joined string.
    return [r.strip() for r in to_field.split(',') if r.strip()]


def unread_for(role, include_inflight=False):
    cur = get_cursor(role)
    c = canon(role)
    pend = read_pending(role)
    acked = read_acked(role)
    now = int(time.time())
    out = []
    for m in read_all():
        if m['id'] <= cur or not addressed(m['to'], role) or canon(m['from']) == c:
            continue
        if m['id'] in acked:
            continue
        sent = pend.get(str(m['id']))
        if sent is not None and not include_inflight and now - sent < REDELIVER_SEC:
            continue  # delivered, still inside its ack window
        out.append(m)
    return out


def inflight_for(role):
    # delivered but not yet acked, and not yet due for redelivery
    pend = read_pending(role)
    now = int(time.time())
    return {int(k): v for k, v in pend.items() if now - v < REDELIVER_SEC}


# --- presence board (liveness without flooding the message log) ---
STATUS_STALE_MIN = 15  # a 'working' status older than this, not marked long-running, is a stall signal


def status_file(role):
    # canonical so an alias (coordinator) shares its target's status
    return os.path.join(BOX, f'status-{canon(role)}')


def set_status(role, state):
    tmp = status_file(role) + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump({'state': state, 'ts': int(time.time())}, f)
    os.replace(tmp, status_file(role))


def get_status(role):
    try:
        with open(status_file(role), encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def all_statuses():
    out = {}
    try:
        names = os.listdir(BOX)
    except FileNotFoundError:
        return out
    for fn in names:
        if fn.startswith('status-') and not fn.endswith('.tmp'):
            st = get_status(fn[len('status-'):])
            if st:
                out[fn[len('status-'):]] = st
    return out


# --- per-lane work stacks (front-load routing; an idle lane self-serves) ---
def queue_file(lane):
    return os.path.join(BOX, f'queue-{canon(lane)}')


def read_queue(lane):
    try:
        with open(queue_file(lane), encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def write_queue(lane, items):
    tmp = queue_file(lane) + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(items, f, indent=1)
    os.replace(tmp, queue_file(lane))


def all_queues():
    out = {}
    try:
        names = os.listdir(BOX)
    except FileNotFoundError:
        return out
    for fn in names:
        if fn.startswith('queue-') and not fn.endswith('.tmp'):
            q = read_queue(fn[len('queue-'):])
            if q:
                out[fn[len('queue-'):]] = q
    return out


# --- mailbox flag (raised = "come check": mail, queue, or a manual note) ---
def flag_file(role):
    # canonical so an alias (coordinator) shares its target's flag
    return os.path.join(BOX, f'flag-{canon(role)}')


def get_flag(role):
    try:
        with open(flag_file(role), encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def flag_counts(role):
    # machine form (also `flag --as X --raw`): unread count, queue depth,
    # note timestamp (0 = none). `flag wait` polls THIS, local or via hub.
    note = get_flag(role)
    return (len(unread_for(role)), len(read_queue(role)),
            (note or {}).get('ts', 0), len(inflight_for(role)))


def flag_check_line(role):
    # the one-line poll answer; shared by `flag` (check) and `flag wait`
    unread = len(unread_for(role))
    qn = len(read_queue(role))
    note = get_flag(role)
    infl = inflight_for(role)
    if not (unread or qn or note):
        if infl:
            return (f'flag down ({canon(role)}: no unread, queue empty) — but {len(infl)} message(s) '
                    f'delivered and UNACKED; ack them or they return to your inbox')
        return f'flag down ({canon(role)}: no unread, queue empty)'
    parts = []
    if unread:
        parts.append(f'{unread} unread → `inbox --as {canon(role)} --headers`')
    if qn:
        parts.append(f'queue {qn} → `queue take --as {canon(role)}`')
    if note:
        parts.append(f"note from {note.get('by', '?')} {age_str(note['ts'])} ago: "
                     f"{note.get('why') or '(no note)'} → `flag lower --as {canon(role)}` once acted on")
    return f"FLAG UP ({canon(role)}): " + ' · '.join(parts)


def broadcast(sender, text, tag='fyi'):
    msgs = read_all()
    msg = {'id': (msgs[-1]['id'] + 1) if msgs else 1, 'ts': int(time.time()),
           'from': sender, 'to': 'all', 'tag': tag, 'text': text}
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(json.dumps(msg) + '\n')
    return msg


def fmt(m):
    ts = time.strftime('%H:%M', time.localtime(m['ts']))
    tag = f" [{m['tag']}]" if m.get('tag') else ''
    head = f"#{m['id']} @{msg_hash(m)} {ts} {m['from']} → {m['to']}{tag}"
    body = m['text'] if '\n' not in m['text'] else '\n  ' + m['text'].replace('\n', '\n  ')
    return f"{head}: {body}" if '\n' not in m['text'] else f"{head}:{body}"


def hdr(m):
    # one-line header: id, from→to, tag, first line only (no body echo).
    ts = time.strftime('%H:%M', time.localtime(m['ts']))
    tag = f" [{m['tag']}]" if m.get('tag') else ''
    first = m['text'].split('\n', 1)[0]
    if len(first) > 100:
        first = first[:97] + '...'
    return f"#{m['id']} @{msg_hash(m)} {ts} {m['from']} → {m['to']}{tag}: {first}"


REMOTE_FILE = os.path.join(BOX, 'remote')


def remote_url():
    url = os.environ.get('AGENT_MAIL_URL', '')
    if url:
        return url.strip().rstrip('/')
    try:
        with open(REMOTE_FILE) as f:
            u = f.read().strip()
            return u.rstrip('/') if u else None
    except FileNotFoundError:
        return None


def my_token():
    tok = os.environ.get('AGENT_MAIL_TOKEN', '').strip()
    if tok:
        return tok
    try:
        with open(os.path.join(BOX, 'token'), encoding='utf-8') as f:
            return f.read().strip()
    except FileNotFoundError:
        return ''


def proxy_raw(argv, url):
    import urllib.request
    headers = {'Content-Type': 'application/json'}
    tok = my_token()
    if tok:
        headers['Authorization'] = 'Bearer ' + tok
    req = urllib.request.Request(url + '/rpc',
        data=json.dumps({'argv': argv}).encode('utf-8'),
        headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            reply = json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            reply = json.loads(e.read().decode('utf-8'))
        except Exception:
            sys.exit(f'mail hub rejected the request ({e.code}) at {url}')
    except Exception as e:
        sys.exit(f'mail hub unreachable at {url}: {e} — fix or delete .agent-mail/remote')
    return reply.get('out', ''), int(reply.get('code', 0))


def proxy(argv, url):
    out, code = proxy_raw(argv, url)
    if out:
        print(out, end='' if out.endswith('\n') else '\n')
    return code


def flag_wait(argv):
    # `flag wait --as <role> [--timeout S] [--interval S]` — a BLOCKING check:
    # returns the moment there is something NEW for the role, else after
    # --timeout. Unread mail or a raised note return immediately; standing
    # QUEUE depth does not (a holding lane may have a stocked queue it cannot
    # take yet) — queue triggers only on an INCREASE over the loop's baseline.
    # Runs CLIENT-side (one cheap poll per interval), so it works identically
    # local and through the hub (whose per-request timeout is 10s and whose
    # threads must never block). This is the idle-lane listening loop: a
    # waiting lane's last action is `flag wait`; on FLAG UP act, on timeout
    # run it again — the lane stays reachable without a human nudge.
    wp = argparse.ArgumentParser(prog='agent-mail.py flag wait')
    wp.add_argument('--as', '--from', '--role', dest='role', required=True)
    wp.add_argument('--timeout', type=int, default=540,
                    help='max seconds to listen before returning (default 540; keep under your shell tool timeout)')
    wp.add_argument('--interval', type=int, default=15)
    a = wp.parse_args(argv)
    url = remote_url()

    def counts():
        if url:
            raw, _ = proxy_raw(['flag', '--as', a.role, '--raw'], url)
            try:
                kv = dict(tok.split('=', 1) for tok in raw.split())
                return (int(kv['unread']), int(kv['queue']),
                        int(kv['note']), int(kv.get('inflight', 0)))
            except (ValueError, KeyError):
                # malformed/empty hub reply (the #2235 race, hub-side fixed by
                # DISPATCH_LOCK) — treat as "no change this poll", never crash
                return None
        return flag_counts(a.role)

    def line():
        if url:
            out, _ = proxy_raw(['flag', '--as', a.role], url)
            return out.strip()
        return flag_check_line(a.role)

    first = counts()
    base_qn = first[1] if first else 0
    deadline = time.time() + max(a.timeout, a.interval)
    while True:
        c = counts()
        if c is not None:
            unread, qn, note_ts = c[0], c[1], c[2]
            if unread or note_ts or qn > base_qn:
                print(line())
                return
            base_qn = qn  # a shrinking queue lowers the baseline
        if time.time() >= deadline:
            print(f'{line()} — nothing new after {a.timeout}s; run `flag wait` again to keep listening')
            return
        time.sleep(min(a.interval, max(1, int(deadline - time.time()))))


# --- hub boundary: allowlist, not blocklist ------------------------------
# The hub used to take raw argv and hand it to dispatch(). That made every
# argparse flag reachable from the network, including --body-file, which
# opens a path on the HUB's disk -- an unauthenticated read of anything the
# process can see, published into the shared mail log. Refusing --body-file
# by name was a blocklist, and blocklists rot: the next path-bearing flag
# anyone adds reopens the hole silently.
#
# So: an explicit per-command allowlist. A flag that is not listed does not
# cross the wire. --body-file is excluded by OMISSION rather than by name,
# which is the property that survives future edits to the CLI.
#
# Wire encodings, both validated by this one table:
#   {"cmd": "send", "from": "a", "to": "b", "body": "..."}   preferred
#   {"argv": ["send", "--from", "a", ...]}                    legacy clients
RPC_SCHEMA = {
    #            flags allowed over the wire            positional args
    'send':      ({'--as', '--to', '--tag', '--body'}, 1),
    'inbox':     ({'--as', '--tag', '--headers', '--ack'}, 0),
    'peek':      ({'--as', '--tag', '--headers'}, 0),
    'ack':       ({'--as'}, None),          # None = any number of positionals
    'log':       ({'-n'}, 0),
    'show':      (set(), 1),
    'who':       (set(), 0),
    'status':    ({'--as'}, 1),
    'queue':     ({'--for', '--as', '--tag', '--id', '--body'}, 1),
    'flag':      ({'--as', '--for', '--why', '--raw'}, 1),
    'lock':      ({'--as', '--why', '--ttl'}, 1),
    'unlock':    ({'--as', '--force'}, 1),
    'locks':     (set(), 0),
    'owner':     ({'--as'}, 1),
    'territory': ({'--as', '--check'}, 0),
}
# flags that take no value, so the validator knows not to consume the next token
RPC_BOOL = {'--headers', '--ack', '--raw', '--check', '--force'}
# every accepted spelling of "who am I", normalised to one canonical flag
IDENTITY = {'--as': '--as', '--from': '--as', '--role': '--as', '--sender': '--as'}
# commands whose positional argument is a repo path used as a registry key
PATH_CMDS = {'lock', 'unlock', 'owner'}


class RpcError(Exception):
    pass


def rpc_normalise(payload):
    """Turn either wire encoding into a validated argv. Raises RpcError."""
    if 'argv' in payload:
        raw = payload['argv']
        if not isinstance(raw, list) or not raw:
            raise RpcError('argv must be a non-empty list')
        argv = [str(x) for x in raw]
    else:
        cmd = payload.get('cmd')
        if not isinstance(cmd, str):
            raise RpcError('missing cmd')
        argv = [cmd]
        for k, v in payload.items():
            if k == 'cmd':
                continue
            if k == 'args':                      # positionals
                argv.extend(str(x) for x in (v if isinstance(v, list) else [v]))
                continue
            flag = '--' + k.replace('_', '-')
            if v is True:
                argv.append(flag)
            elif v not in (False, None):
                argv.extend([flag, str(v)])

    cmd = argv[0]
    if cmd not in RPC_SCHEMA:
        raise RpcError(f'unknown or non-remote command: {cmd}')
    allowed, npos = RPC_SCHEMA[cmd]

    out, pos, i = [cmd], [], 1
    while i < len(argv):
        tok = argv[i]
        if tok.startswith('-') and tok != '-':
            name, inline = (tok.split('=', 1) + [None])[:2]
            canon_flag = IDENTITY.get(name, name)
            if canon_flag not in allowed:
                raise RpcError(f'flag not permitted over the wire for {cmd}: {name}')
            out.append(canon_flag)
            if canon_flag not in RPC_BOOL:
                if inline is not None:
                    out.append(inline)
                elif i + 1 < len(argv):
                    i += 1
                    out.append(argv[i])
                else:
                    raise RpcError(f'{name} expects a value')
        else:
            pos.append(tok)
        i += 1

    if npos is not None and len(pos) > npos:
        raise RpcError(f'{cmd} takes at most {npos} positional argument(s)')
    if cmd in PATH_CMDS and pos:
        # a registry key, never opened -- but keep it inside the repo so it
        # cannot masquerade as something outside the project
        p = pos[0].replace(os.sep, '/')
        if p.startswith('/') or '..' in p.split('/'):
            raise RpcError(f'path must be repo-relative: {pos[0]}')
    return out + pos


def load_tokens():
    """token -> (lane, is_admin). Absent file means auth disabled."""
    out = {}
    try:
        with open(os.path.join(BOX, 'tokens'), encoding='utf-8') as f:
            for line in f:
                line = line.split('#', 1)[0].strip()
                if '=' not in line:
                    continue
                tok, rest = (x.strip() for x in line.split('=', 1))
                parts = rest.split()
                if tok and parts:
                    out[tok] = (canon(parts[0]), 'admin' in parts[1:])
    except FileNotFoundError:
        pass
    return out


def rpc_authorise(argv, lane, is_admin):
    """Bind the caller's asserted identity to their token."""
    for i, tok in enumerate(argv):
        if tok == '--as' and i + 1 < len(argv):
            claimed = canon(argv[i + 1])
            if claimed != lane and not is_admin:
                raise RpcError(f'token is for {lane}, cannot act as {claimed}')
    if '--force' in argv and not is_admin:
        raise RpcError('--force is arbitration and requires an admin token')


def serve(host, port):
    import io
    import contextlib
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    DISPATCH_LOCK = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):  # quiet; the hub prints its own line on start
            pass

        def do_GET(self):
            body = f'agent-mail hub · {len(read_all())} messages · {len(read_locks())} locks\n'.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            if self.path != '/rpc':
                self.send_response(404); self.end_headers(); return
            tokens = load_tokens()
            try:
                length = int(self.headers.get('Content-Length', 0))
                payload = json.loads(self.rfile.read(length).decode('utf-8'))
                if not isinstance(payload, dict):
                    raise RpcError('body must be a JSON object')
                lane, is_admin = None, True
                if tokens:
                    supplied = (self.headers.get('Authorization', '')
                                .removeprefix('Bearer ').strip())
                    match = None
                    for known, meta in tokens.items():
                        # compare every entry so timing does not leak which
                        # prefix was right
                        if hmac.compare_digest(supplied, known):
                            match = meta
                    if match is None:
                        self.send_response(401)
                        self.send_header('Content-Type', 'application/json')
                        self.end_headers()
                        self.wfile.write(json.dumps(
                            {'out': 'unauthorised: bad or missing token', 'code': 1}).encode())
                        return
                    lane, is_admin = match
                argv = rpc_normalise(payload)
                if lane is not None:
                    rpc_authorise(argv, lane, is_admin)
            except RpcError as e:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'out': f'refused: {e}', 'code': 1}).encode())
                return
            except Exception:
                self.send_response(400); self.end_headers(); return
                self.send_response(400); self.end_headers(); return
            buf = io.StringIO()
            code = 0
            # SERIALIZED: redirect_stdout swaps the PROCESS-global stdout, so
            # concurrent requests under ThreadingHTTPServer raced and one got
            # an empty reply (the #2235 flag-wait bug). Dispatch is cheap file
            # ops; one at a time is correct and also guards the store writes.
            with DISPATCH_LOCK, contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                try:
                    dispatch([str(a) for a in argv])
                except SystemExit as e:
                    if isinstance(e.code, str):
                        print(e.code)
                        code = 1
                    else:
                        code = e.code or 0
                except Exception as e:  # keep the hub alive; report the error
                    print(f'hub error: {e}')
                    code = 1
            body = json.dumps({'out': buf.getvalue(), 'code': code}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(body)

    def reaper():
        # THE PIECE NOTHING ELSE PROVIDES. Every agent-mail action is driven by
        # an agent taking a turn; when a lane goes dark, nothing notices. The
        # hub is the one long-lived process in the system, so it is the only
        # place a watchdog can live. It runs no model and costs no tokens --
        # it just re-raises flags so a human or the architect finds out.
        SILENT_MIN = 25    # a lane whose status has not moved in this long
        while True:
            time.sleep(60)
            try:
                with DISPATCH_LOCK:
                    now = int(time.time())

                    # 1. expired leases: free them and say so, once
                    locks = read_locks()
                    freed = [k for k, h in locks.items() if lock_expired(h, now)]
                    for k in freed:
                        h = locks.pop(k)
                        broadcast('hub', f"LEASE EXPIRED: {k} released (was {h['by']}'s, "
                                         f"held {age_str(h['ts'])}: {h.get('why') or 'no reason'})")
                    if freed:
                        write_locks(locks)

                    # 2. a lane that has gone quiet: raise the architect's flag
                    #    so the stall surfaces without a human noticing first
                    for role, stt in all_statuses().items():
                        mins = (now - stt['ts']) / 60
                        if mins < SILENT_MIN or role == 'architect':
                            continue
                        seen = get_flag('architect') or {}
                        if seen.get('why', '').startswith(f'{role} silent'):
                            continue  # already flagged; do not spam
                        _write_json(flag_file('architect'),
                                    {'why': f'{role} silent {int(mins)}m (last: {stt["state"]}) '
                                            f'— check the lane or requeue its work',
                                     'by': 'hub', 'ts': now})
            except Exception as e:  # a reaper must never take the hub down
                print(f'reaper error: {e}')

    threading.Thread(target=reaper, daemon=True).start()
    srv = ThreadingHTTPServer((host, port), Handler)
    auth = load_tokens()
    print(f'agent-mail hub listening on {host}:{port} (store: {BOX}) · reaper active · '
          + (f'auth ON ({len(auth)} tokens)' if auth else 'auth OFF'))
    if not auth:
        print('  WARNING: no .agent-mail/tokens — any client may claim any lane identity')
    if host == '0.0.0.0':
        print('  WARNING: bound to 0.0.0.0 — reachable from every interface on this box')
    srv.serve_forever()


def main():
    argv = sys.argv[1:]
    if argv and argv[0] == 'serve':
        sp = argparse.ArgumentParser()
        sp.add_argument('serve')
        sp.add_argument('--port', type=int, default=8970)
        sp.add_argument('--host', default='127.0.0.1',
                        help='default 127.0.0.1; pass a LAN or Tailscale address '
                             'deliberately, never 0.0.0.0 on a public-facing box')
        a = sp.parse_args(argv)
        os.makedirs(BOX, exist_ok=True)
        serve(a.host, a.port)
        return
    if argv[:2] == ['flag', 'wait']:
        # client-side always — the blocking loop must never reach the hub
        flag_wait(argv[2:])
        return
    url = remote_url()
    if url:
        # resolve stdin bodies BEFORE proxying — the hub's stdin is empty,
        # so a literal '-' must become text on the client side
        if '-' in argv:
            body = sys.stdin.read().strip()
            argv = [body if a == '-' else a for a in argv]
        # resolve --body-file BEFORE proxying too — the path is local to
        # THIS machine; the hub must receive the CONTENT, never the path
        # (a remote sender's /tmp does not exist on the hub's disk)
        out, i = [], 0
        while i < len(argv):
            a = argv[i]
            if a == '--body-file' and i + 1 < len(argv):
                with open(argv[i + 1], encoding='utf-8') as f:
                    out.extend(['--body', f.read().strip()])
                i += 2
            elif a.startswith('--body-file='):
                with open(a.split('=', 1)[1], encoding='utf-8') as f:
                    out.extend(['--body', f.read().strip()])
                i += 1
            else:
                out.append(a)
                i += 1
        argv = out
        sys.exit(proxy(argv, url))
    dispatch(argv)


def dispatch(argv):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)

    s = sub.add_parser('send')
    s.add_argument('--from', '--as', '--sender', dest='sender', required=True)
    s.add_argument('--to', dest='to', required=True)
    s.add_argument('--tag', dest='tag', default='')
    s.add_argument('text', nargs='?', default=None,
                   help="message body, or '-' to read from stdin")
    s.add_argument('--body', '--text', '--message', '-m', dest='body',
                   default=None, help='message body (alias for the positional)')
    s.add_argument('--body-file', dest='body_file', default=None,
                   help='read the body from a file (keeps it out of the command line/transcript)')

    for name in ('inbox', 'peek'):
        i = sub.add_parser(name)
        i.add_argument('--as', '--from', '--role', dest='role', required=True)
        i.add_argument('--tag', dest='tag', default='')
        i.add_argument('--headers', action='store_true',
                       help='one line per message (id/from→to/tag/first line); expand one with `show #id`')
        i.add_argument('--ack', action='store_true',
                       help='settle the displayed messages immediately (for lanes where reading IS acting)')

    ak = sub.add_parser('ack', help='settle delivered messages so they stop being redelivered')
    ak.add_argument('refs', nargs='+', help='message hashes (@abc12345) or #ids')
    ak.add_argument('--as', '--from', '--role', dest='role', required=True)

    l = sub.add_parser('log')
    l.add_argument('-n', type=int, default=15)

    sh = sub.add_parser('show')
    sh.add_argument('prefix', help='global message hash (or unique prefix)')

    sub.add_parser('who')

    st = sub.add_parser('status')
    st.add_argument('--as', '--from', '--role', dest='role', default=None)
    st.add_argument('text', nargs='?', default=None,
                    help="set your status (waiting / working X / working X (long ~Nm)); omit to print the board")

    q = sub.add_parser('queue')
    q.add_argument('action', choices=['add', 'take', 'list', 'drop'],
                   help="add --for <lane> an item; take --as <lane> your next; list [--for <lane>]; drop --for <lane> --id N")
    q.add_argument('--for', dest='forlane', default=None)
    q.add_argument('--as', '--from', '--role', dest='role', default=None)
    q.add_argument('--tag', dest='tag', default='')
    q.add_argument('--id', dest='qid', type=int, default=None)
    q.add_argument('--body', '--text', '-m', dest='body', default=None,
                   help="item body for `add` (short); use --body-file for substantive; '-' for stdin")
    q.add_argument('--body-file', dest='body_file', default=None)

    fl = sub.add_parser('flag')
    fl.add_argument('action', nargs='?', default='check', choices=['check', 'raise', 'lower'],
                    help="check --as <role> (the 10-min poll); raise --for <role> [--why]; lower --as <role>; "
                         "`flag wait --as <role>` = the blocking idle-lane loop (client-side, see docstring)")
    fl.add_argument('--as', '--from', '--role', dest='role', default=None)
    fl.add_argument('--for', dest='forlane', default=None)
    fl.add_argument('--why', '--reason', dest='why', default='')
    fl.add_argument('--raw', action='store_true',
                    help='machine form for check: "unread=N queue=N note=TS" (flag wait polls this)')

    lk = sub.add_parser('lock')
    lk.add_argument('path', help='file to lock (repo-relative)')
    lk.add_argument('--as', '--from', '--role', dest='role', required=True)
    lk.add_argument('--why', '--reason', dest='why', default='')
    lk.add_argument('--ttl', type=int, default=None,
                    help=f'lease minutes before the lock expires on its own (default {LOCK_TTL_MIN}); '
                         're-run `lock` to renew')

    ul = sub.add_parser('unlock')
    ul.add_argument('path')
    ul.add_argument('--as', '--from', '--role', dest='role', required=True)
    ul.add_argument('--force', action='store_true',
                    help='architect arbitration: release someone else\'s lock (broadcasts)')

    sub.add_parser('locks')

    ow = sub.add_parser('owner', help='who owns this path (and may I just edit it?)')
    ow.add_argument('path')
    ow.add_argument('--as', '--from', '--role', dest='role', default=None)

    ows = sub.add_parser('territory', help='what a lane owns; no --as prints the whole map')
    ows.add_argument('--as', '--from', '--role', dest='role', default=None)
    ows.add_argument('--check', action='store_true',
                     help='walk the repo and report files claimed by two lanes, or claimed by none')

    a = p.parse_args(argv)
    os.makedirs(BOX, exist_ok=True)

    if a.cmd == 'send':
        given = [x for x in (a.text, a.body, a.body_file) if x is not None]
        if len(given) > 1:
            sys.exit('give the body once: positional, --body, or --body-file')
        if a.body_file is not None:
            with open(a.body_file, encoding='utf-8') as f:
                text = f.read().strip()
        else:
            raw = a.body if a.body is not None else a.text
            if raw is None:
                sys.exit('missing message body (positional text, --body "...", or --body-file PATH)')
            text = sys.stdin.read().strip() if raw == '-' else raw
        if not text:
            sys.exit('empty message')
        msgs = read_all()
        msg = {'id': (msgs[-1]['id'] + 1) if msgs else 1, 'ts': int(time.time()),
               'from': a.sender, 'to': a.to, 'text': text}
        if a.tag:
            msg['tag'] = a.tag
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(json.dumps(msg) + '\n')
        # receipt only — never echo the body back to stdout/the transcript.
        tagpart = f"{a.tag} " if a.tag else ''
        print(f"queued {tagpart}#{msg['id']} → {a.to}")

    elif a.cmd in ('inbox', 'peek'):
        msgs = unread_for(a.role)
        if a.tag:
            msgs = [m for m in msgs if m.get('tag') == a.tag]
        if not msgs:
            print(f'({a.role}: no unread)')
        else:
            for m in msgs:
                print(hdr(m) if a.headers else fmt(m))
            if a.cmd == 'inbox':
                if a.ack:
                    # reading IS acting for this lane: settle immediately, but
                    # ONLY what we displayed -- never what --tag filtered out
                    settle(a.role, [m['id'] for m in msgs])
                else:
                    deliver(a.role, msgs)
                    hashes = ' '.join('@' + msg_hash(m) for m in msgs)
                    print(f"-- ACK REQUIRED: `ack {hashes} --as {canon(a.role)}` when acted on "
                          f"(unacked mail returns to this inbox in {REDELIVER_SEC // 60}m)")
        # anti-stale-idle: an empty inbox is NOT an idle verdict — surface the
        # work stack at the exact moment a lane forms its "nothing to do" belief
        q = read_queue(a.role)
        if q:
            print(f"note: {len(q)} queued item(s) for {canon(a.role)} — `queue take --as {canon(a.role)}` pops the next")
        note = get_flag(a.role)
        if note:
            print(f"note: 🚩 flag note from {note.get('by', '?')}: {note.get('why') or '(no note)'} — "
                  f"`flag lower --as {canon(a.role)}` once acted on")

    elif a.cmd == 'ack':
        msgs = read_all()
        want = []
        for ref in a.refs:
            r = ref.lstrip('@#')
            if r.isdigit():
                want.append(int(r))
                continue
            hits = [m for m in msgs if msg_hash(m).startswith(r)]
            if len(hits) != 1:
                sys.exit(f'ack: {ref} matches {len(hits)} messages — use a longer hash or #id')
            want.append(hits[0]['id'])
        cur = settle(a.role, want)
        print(f'acked {len(want)} for {canon(a.role)} · cursor #{cur} · '
              f'{len(unread_for(a.role))} unread · {len(inflight_for(a.role))} in flight')

    elif a.cmd == 'log':
        for m in read_all()[-a.n:]:
            print(fmt(m))

    elif a.cmd == 'show':
        hits = [m for m in read_all() if msg_hash(m).startswith(a.prefix.lstrip('@'))]
        if not hits:
            sys.exit(f'no message matches @{a.prefix}')
        if len(hits) > 1:
            sys.exit(f'ambiguous: {len(hits)} messages match @{a.prefix} — use more characters')
        print(fmt(hits[0]))

    elif a.cmd == 'who':
        msgs = read_all()
        aliases = load_aliases()
        roles = sorted({canon(m['from']) for m in msgs}
                       | {canon(r) for m in msgs if m['to'] != 'all'
                          for r in recipients(m['to'])})
        for r in roles:
            print(f'{r}: {len(unread_for(r))} unread')
        for alias, target in sorted(aliases.items()):
            print(f'  (alias) {alias} → {target}')

    elif a.cmd == 'status':
        if a.text is not None:
            if not a.role:
                sys.exit('status: --as <role> required to SET a status')
            # anti-stale-idle guard (2026-07-21): a lane may not declare itself
            # plain-"waiting" while its work stack holds items — either take the
            # next item, or NAME what it is waiting on (await/block/park/hold/
            # gate/pending in the text passes the guard).
            low = a.text.strip().lower()
            if low.startswith('waiting'):
                q = read_queue(a.role)
                if q and not any(w in low for w in ('await', 'block', 'park', 'hold', 'gate', 'pending')):
                    sys.exit(f"status REJECTED: {canon(a.role)} has {len(q)} queued item(s) — "
                             f"run `queue take --as {canon(a.role)}` and post working, "
                             f"or say WHAT you are waiting on (awaiting/blocked/parked/holding/gated/pending …).")
            set_status(a.role, a.text)
            print(f'status[{canon(a.role)}] = {a.text}')
        else:
            board = all_statuses()
            if not board:
                print('(no statuses posted yet)')
            else:
                now = int(time.time())
                # oldest first so a stale lane surfaces at the top
                for role, stt in sorted(board.items(), key=lambda kv: kv[1]['ts']):
                    s = stt['state']
                    mins = (now - stt['ts']) / 60
                    stale = mins > STATUS_STALE_MIN and 'working' in s.lower() and 'long' not in s.lower()
                    qn = len(read_queue(role))
                    qtag = f' · queue {qn}' if qn else ''
                    ftag = ' · 🚩flag' if get_flag(role) else ''
                    print(f"{role}: {s}  ({age_str(stt['ts'])} ago){' ⚠STALE' if stale else ''}{qtag}{ftag}")

    elif a.cmd == 'queue':
        if a.action == 'add':
            if not a.forlane:
                sys.exit('queue add: --for <lane> required')
            if a.body_file:
                with open(a.body_file, encoding='utf-8') as f:
                    text = f.read().strip()
            elif a.body is not None:
                text = a.body
            else:
                text = None
            if text == '-':
                text = sys.stdin.read().strip()
            if not text:
                sys.exit('queue add: needs an item body (--body, --body-file, or - for stdin)')
            items = read_queue(a.forlane)
            nid = max([it.get('id', 0) for it in items], default=0) + 1
            items.append({'id': nid, 'tag': a.tag, 'text': text, 'ts': int(time.time()),
                          'by': canon(a.role) if a.role else 'architect'})
            write_queue(a.forlane, items)
            print(f'queued item #{nid}{" [" + a.tag + "]" if a.tag else ""} → {canon(a.forlane)} (depth {len(items)})')
        elif a.action == 'take':
            if not a.role:
                sys.exit('queue take: --as <lane> required')
            items = read_queue(a.role)
            if not items:
                print(f'({canon(a.role)} queue empty)')
            else:
                it = items.pop(0)
                write_queue(a.role, items)
                ts = time.strftime('%H:%M', time.localtime(it.get('ts', 0)))
                tag = f" [{it['tag']}]" if it.get('tag') else ''
                print(f"taken #{it.get('id')}{tag} (added {ts} by {it.get('by','?')}, {len(items)} left):")
                print(it['text'])
        elif a.action == 'list':
            board = {canon(a.forlane): read_queue(a.forlane)} if a.forlane else all_queues()
            if not any(board.values()):
                print('(all queues empty)')
            else:
                for lane, items in sorted(board.items()):
                    if not items:
                        continue
                    print(f'{lane}: {len(items)} queued')
                    for it in items:
                        head = it['text'].split('\n')[0][:70]
                        tag = f"[{it['tag']}] " if it.get('tag') else ''
                        print(f"  #{it.get('id')} {tag}{head}")
        elif a.action == 'drop':
            if not a.forlane or a.qid is None:
                sys.exit('queue drop: --for <lane> --id <n> required')
            items = read_queue(a.forlane)
            n = len(items)
            items = [it for it in items if it.get('id') != a.qid]
            write_queue(a.forlane, items)
            print(f'dropped #{a.qid} from {canon(a.forlane)} ({len(items)} left)' if len(items) < n
                  else f'#{a.qid} not in {canon(a.forlane)}')

    elif a.cmd == 'flag':
        if a.action == 'check':
            role = a.role or a.forlane
            if not role:
                sys.exit('flag: --as <role> required to check your flag')
            if a.raw:
                # WIRE FORMAT — three fields, frozen. An old lane parses this
                # with `u, q, n = raw.split()`, so a fourth field makes that
                # raise, flag_wait's counts() return None, and the lane stop
                # waking on mail -- silently, which is the exact bug we set out
                # to kill. Ack debt is surfaced in the human-readable line
                # instead, which nothing parses.
                u, q, n, _ = flag_counts(role)
                print(f'unread={u} queue={q} note={n}')
            else:
                print(flag_check_line(role))
        elif a.action == 'raise':
            if not a.forlane:
                sys.exit('flag raise: --for <role> required (whose flag goes up)')
            tmp = flag_file(a.forlane) + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump({'why': a.why, 'by': canon(a.role) if a.role else 'architect',
                           'ts': int(time.time())}, f)
            os.replace(tmp, flag_file(a.forlane))
            print(f'flag raised for {canon(a.forlane)}')
        elif a.action == 'lower':
            role = a.role or a.forlane
            if not role:
                sys.exit('flag lower: --as <role> required')
            note = get_flag(role)
            if not note:
                print(f'({canon(role)}: no manual flag was raised)')
            else:
                os.remove(flag_file(role))
                print(f"flag lowered for {canon(role)} (was from {note.get('by', '?')}: "
                      f"{note.get('why') or 'no note'})")

    elif a.cmd == 'lock':
        locks = read_locks()
        key = norm_path(a.path)
        owner, pat = owner_of(key)
        if owner and owner == canon(a.role):
            print(f'{key} is yours ({pat}) — no lock needed, just edit it')
            return
        held = locks.get(key)
        if held and held['by'] != a.role and not lock_expired(held):
            mins = held.get('ttl', LOCK_TTL_MIN) - int((time.time() - held['ts']) / 60)
            sys.exit(f"DENIED: {key} locked by {held['by']} {age_str(held['ts'])} ago"
                     f" ({held.get('why') or 'no reason given'}) — lease expires in ~{mins}m;"
                     f" mail them or the architect")
        stolen = held if (held and held['by'] != a.role) else None
        locks[key] = {'by': a.role, 'ts': int(time.time()), 'why': a.why,
                      'ttl': a.ttl or LOCK_TTL_MIN}
        write_locks(locks)
        print(f'locked {key} for {a.role} ({locks[key]["ttl"]}m lease)'
              + (' (renewed)' if held and not stolen else ''))
        if stolen:
            # a takeover is arbitration — everyone hears about it, same as --force
            print(f"  took over EXPIRED lease from {stolen['by']} "
                  f"(held {age_str(stolen['ts'])}, {stolen.get('why') or 'no reason'})")
            broadcast(a.role, f"LEASE EXPIRED: {key} taken over from {stolen['by']} "
                              f"(held {age_str(stolen['ts'])}: {stolen.get('why') or 'no reason'})")
        if owner:
            # borrowing someone else's ground: the lock IS the notification,
            # so nobody has to remember a separate "heads up" mail
            msg = {'id': (read_all()[-1]['id'] + 1) if read_all() else 1,
                   'ts': int(time.time()), 'from': a.role, 'to': owner, 'tag': 'claim',
                   'text': f"BORROWING {key} (your territory: {pat}) for "
                           f"{locks[key]['ttl']}m — {a.why or 'no reason given'}"}
            with open(LOG, 'a', encoding='utf-8') as f:
                f.write(json.dumps(msg) + '\n')
            print(f'  {key} is {owner}\'s territory ({pat}) — mailed them #{msg["id"]}')

    elif a.cmd == 'unlock':
        locks = read_locks()
        key = norm_path(a.path)
        held = locks.get(key)
        if not held:
            print(f'{key} was not locked')
            return
        if held['by'] != a.role and not a.force:
            sys.exit(f"DENIED: {key} is {held['by']}'s lock — only they (or --force by the architect) release it")
        del locks[key]
        write_locks(locks)
        print(f'unlocked {key}')
        if held['by'] != a.role:
            # forced release is arbitration — everyone hears about it
            msg = broadcast(a.role, f"FORCED UNLOCK: {key} (was {held['by']}'s: "
                                    f"{held.get('why') or 'no reason'})")
            print(f"broadcast #{msg['id']} @{msg_hash(msg)}")

    elif a.cmd == 'owner':
        key = norm_path(a.path)
        lane, pat = owner_of(key)
        held = read_locks().get(key)
        if is_ignored(key):
            print(f'{key}: GENERATED/VENDORED — not territory, never lock it '
                  f'(and it should be gitignored)')
            return
        if lane is None:
            print(f'{key}: UNOWNED — lock it before editing '
                  f'(`lock {key} --as <you> --why ...`)')
        elif a.role and lane == canon(a.role):
            print(f'{key}: YOURS ({pat}) — edit freely, no lock')
        else:
            print(f'{key}: {lane}\'s territory ({pat}) — `lock` it to borrow '
                  f'(they get mailed automatically)')
        if held:
            ttl = held.get('ttl', LOCK_TTL_MIN)
            left = ttl - int((time.time() - held['ts']) / 60)
            print(f'  currently leased by {held["by"]}, '
                  f'{"EXPIRED" if left <= 0 else str(left) + "m left"}')

    elif a.cmd == 'territory':
        owners = load_owners()
        if not owners:
            print('(no .agent-mail/owners manifest — every edit needs a lock)')
            return
        if a.check:
            claimed, clashes, orphans = {}, [], []
            skip = {'.git', 'node_modules', '.agent-mail', '__pycache__'}
            for root, dirs, files in os.walk(ROOT):
                dirs[:] = [d for d in dirs if d not in skip]
                for fn in files:
                    rel = norm_path(os.path.join(root, fn))
                    if is_ignored(rel):
                        continue
                    hits = [(l, p) for l, ps in owners.items() for p in ps
                            if glob_to_re(p).match(rel)]
                    if not hits:
                        orphans.append(rel)
                        continue
                    top = max(len(p) for _, p in hits)
                    lanes = {l for l, p in hits if len(p) == top}
                    if len(lanes) > 1:
                        clashes.append((rel, sorted(lanes)))
                    claimed.setdefault(sorted(lanes)[0], []).append(rel)
            for rel, lanes in clashes:
                print(f'CLASH {rel}: claimed equally by {", ".join(lanes)}')
            if orphans:
                print(f'{len(orphans)} unowned file(s) — these need locks. e.g. '
                      + ', '.join(orphans[:5]) + ('...' if len(orphans) > 5 else ''))
            for lane in sorted(claimed):
                print(f'{lane}: {len(claimed[lane])} file(s)')
            if not clashes:
                print('no overlapping claims')
        elif a.role:
            pats = owners.get(canon(a.role), [])
            print(f'{canon(a.role)} owns: ' + (', '.join(pats) if pats else '(nothing declared)'))
        else:
            for lane in sorted(owners):
                print(f'{lane}: ' + ', '.join(owners[lane]))

    elif a.cmd == 'locks':
        locks = read_locks()
        if not locks:
            print('(no locks held)')
            return
        now = int(time.time())
        for key in sorted(locks):
            h = locks[key]
            ttl = h.get('ttl', LOCK_TTL_MIN)
            left = ttl - int((now - h['ts']) / 60)
            state = 'EXPIRED — free to take' if left <= 0 else f'{left}m left'
            print(f"{key}  ·  {h['by']}  ·  held {age_str(h['ts'])}  ·  {state}  ·  {h.get('why') or '-'}")


if __name__ == '__main__':
    main()
