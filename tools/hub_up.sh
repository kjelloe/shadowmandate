#!/bin/bash
# tools/hub_up.sh — start (or confirm) the Shadow Mandate agent-mail hub,
# LAN-reachable. Idempotent; run after any WSL restart.
#
# PORT 8972. The sibling projects own 8970 (multiciv) and 8971 (firepower);
# one hub per project keeps their queues from ever crossing (D25 shares the
# WORKER machine, not the queue).
#
# ── PREREQUISITES (Windows side of THIS dev machine, ADMIN PowerShell) ──
#
#   netsh interface portproxy add v4tov4 listenport=8972 listenaddress=0.0.0.0 connectport=8972 connectaddress=<WSL-IP>
#   netsh advfirewall firewall add rule name="shadow-mandate agent-mail hub" dir=in action=allow protocol=TCP localport=8972
#
# The FIREWALL rule is one-time. The PORTPROXY is NOT: the WSL IP changes on
# almost every reboot, and a stale connectaddress silently black-holes every
# inbound connection — the gaming PC's worker sits in flag-wait forever with no
# error anywhere, on either machine. THIS SCRIPT DETECTS THAT and prints the
# exact refresh commands. If the worker "can't reach the hub", run this FIRST.

cd "$(dirname "$0")/.."
PORT=8972
RULE="shadow-mandate agent-mail hub"
WSL_IP=$(hostname -I | awk '{print $1}')

if ss -tln 2>/dev/null | grep -q ":$PORT "; then
  echo "hub: already listening on $PORT"
else
  setsid nohup python3 tools/agent-mail.py serve --port $PORT --host 0.0.0.0 \
    > /tmp/sm-agent-mail-hub.log 2>&1 &
  sleep 1
  if ss -tln | grep -q ":$PORT "; then
    echo "hub: started (log: /tmp/sm-agent-mail-hub.log)"
  else
    echo "hub: FAILED to start — see /tmp/sm-agent-mail-hub.log" >&2
    exit 1
  fi
fi
echo "hub: WSL IP is $WSL_IP"
echo "hub: gaming PC should point its remote at  http://<this-machine-LAN-IP>:$PORT"

PROXY_TARGET=$(netsh.exe interface portproxy show v4tov4 2>/dev/null \
  | awk -v p="$PORT" '$2 == p { print $3 }' | tr -d '\r' | head -1)
if [ -z "$PROXY_TARGET" ]; then
  cat >&2 <<EOF

!! portproxy MISSING for $PORT — remote machines CANNOT reach the hub.
   Fix in an ADMIN PowerShell on Windows:
     netsh interface portproxy add v4tov4 listenport=$PORT listenaddress=0.0.0.0 connectport=$PORT connectaddress=$WSL_IP
EOF
elif [ "$PROXY_TARGET" != "$WSL_IP" ]; then
  cat >&2 <<EOF

!! portproxy is STALE: it forwards $PORT to $PROXY_TARGET but WSL now lives at
   $WSL_IP (this happens after reboots). The worker will hang SILENTLY until
   it is refreshed, in an ADMIN PowerShell:
     netsh interface portproxy delete v4tov4 listenport=$PORT listenaddress=0.0.0.0
     netsh interface portproxy add v4tov4 listenport=$PORT listenaddress=0.0.0.0 connectport=$PORT connectaddress=$WSL_IP
EOF
else
  echo "portproxy: OK ($PORT -> $PROXY_TARGET)"
fi

if netsh.exe advfirewall firewall show rule name="$RULE" 2>/dev/null | grep -q "$PORT"; then
  echo "firewall: OK (rule '$RULE' present)"
else
  cat >&2 <<EOF

!! firewall rule missing — inbound $PORT is blocked on Windows.
   Fix in an ADMIN PowerShell:
     netsh advfirewall firewall add rule name="$RULE" dir=in action=allow protocol=TCP localport=$PORT
EOF
fi
