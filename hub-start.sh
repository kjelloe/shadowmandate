#!/bin/bash
echo "Starting agent-mail hub on port 8972"
nohup python3 tools/agent-mail.py serve --port 8972 --host 0.0.0.0 > ./debugging/hub.log 2>&1 &
# echo "Staring lane-watcher using lanes config: $(cat ~/lanes.json)"
# nohup python3 tools/lane-watcher.py --config ~/lanes.json > ./debugging/lanes.log 2>&1 &
