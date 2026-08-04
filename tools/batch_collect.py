#!/usr/bin/env python3
"""tools/batch_collect.py — extract mailed CSVs into reports/sweeps/.

Results are gitignored, so MAIL IS THE ONLY CHANNEL home.

Parses `agent-mail.py inbox` text output. There is no --json mode (checked, not
assumed): the inbox prints a `#N @id time from -> to [tag]:` header and then
indents the body by two spaces, so the body is recovered by stripping that
indent. A collector that silently overwrites two different runs sharing a label
loses history, so an existing differing file is shelved as .prev.
"""
import os, re, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "reports", "sweeps")
AM = os.path.join(ROOT, "tools", "agent-mail.py")
HEADER = re.compile(r"^#\d+ @([0-9a-f]+) .*\[(\w+)\]:\s*$")

def fetch(tag):
    r = subprocess.run(["python3", AM, "inbox", "--as", "dev", "--tag", tag],
                       capture_output=True, text=True, cwd=ROOT)
    if r.returncode != 0:
        print(f"agent-mail inbox failed: {r.stderr.strip()}", file=sys.stderr)
        return []
    messages, current = [], None
    for line in r.stdout.splitlines():
        m = HEADER.match(line)
        if m:
            if current:
                messages.append(current)
            current = {"id": m.group(1), "tag": m.group(2), "lines": []}
        elif current is not None:
            if line.startswith("-- ACK REQUIRED"):
                messages.append(current); current = None
            elif line.startswith("  "):
                current["lines"].append(line[2:])
    if current:
        messages.append(current)
    return messages

def main():
    os.makedirs(OUT, exist_ok=True)
    written = 0
    for tag in ("csv", "report"):
        for msg in fetch(tag):
            body = msg["lines"]
            if not body or not body[0].startswith("#file:"):
                continue
            name = os.path.basename(body[0][len("#file:"):].strip())
            if not name:
                continue
            payload = "\n".join(body[1:]) + "\n"
            path = os.path.join(OUT, name)
            if os.path.exists(path):
                with open(path) as f:
                    if f.read() == payload:
                        subprocess.run(["python3", AM, "ack", "@" + msg["id"], "--as", "dev"],
                                       capture_output=True, cwd=ROOT)
                        continue
                shutil.move(path, path + ".prev")
                print(f"shelved previous {name} -> {name}.prev")
            with open(path, "w") as f:
                f.write(payload)
            subprocess.run(["python3", AM, "ack", "@" + msg["id"], "--as", "dev"],
                           capture_output=True, cwd=ROOT)
            written += 1
            print(f"collected {name}")
    print(f"{written} file(s) into reports/sweeps/")

if __name__ == "__main__":
    main()
