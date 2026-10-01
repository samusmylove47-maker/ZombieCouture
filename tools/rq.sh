#!/bin/bash
# Render queue: runs a command in one of two slots so several people/agents testing at once cannot swamp the 2-core box.
#   tools/rq.sh python3 tools/shoot.py felt preview out/x.png 640 360 "p=set&set=atelier"
# Low priority (nice 12) so the long frame farms keep most of the CPU.
flock -n -E 200 /tmp/zc_slot1.lock nice -n 0 "$@"; rc=$?
[ $rc -ne 200 ] && exit $rc
flock -n -E 200 /tmp/zc_slot2.lock nice -n 0 "$@"; rc=$?
[ $rc -ne 200 ] && exit $rc
exec flock /tmp/zc_slot1.lock nice -n 0 "$@"
