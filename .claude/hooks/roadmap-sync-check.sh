#!/bin/bash
# Stop hook: reminds the session to sync ROADMAP.md against CLAUDE.md
# whenever CLAUDE.md has gained commits since the last sync was recorded.
#
# Why this exists: ROADMAP.md (the project's designated implementation
# backlog) is only useful if it stays current against CLAUDE.md's own
# dated changelog. Without a mechanical check, this drifts silently —
# exactly the failure ROADMAP.md itself was created to fix (see its own
# header). CLAUDE.md's own established convention is that every real
# change gets a dated entry there, so "CLAUDE.md changed" is a reliable
# proxy for "real work happened," matching the "not a trivial Q&A" bar.
#
# Mechanism: compares CLAUDE.md's current last-commit SHA against a
# marker file recording the SHA that was last reconciled. If they
# differ, blocks the stop and hands back a reason telling the session
# to do the sync, then update+commit+push the marker so the next Stop
# check passes cleanly. This is why the marker is committed to git, not
# just a local file — this project's sessions start from a fresh clone
# each time (see CLAUDE.md's own "Environment" notes), so anything not
# pushed doesn't persist to the next session.

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -f CLAUDE.md ] && [ -f ROADMAP.md ] || exit 0

MARKER_FILE=.claude/roadmap-sync-marker
CURRENT=$(git log -1 --format=%H -- CLAUDE.md 2>/dev/null)
MARKER=$(cat "$MARKER_FILE" 2>/dev/null || echo "")

if [ -n "$CURRENT" ] && [ "$CURRENT" != "$MARKER" ]; then
  cat <<EOF
{"decision":"block","reason":"CLAUDE.md has commits since ROADMAP.md was last synced against it (marker: ${MARKER:-none}, current CLAUDE.md commit: $CURRENT). Before finishing: read the CLAUDE.md entries added since the last sync, compare against ROADMAP.md (add anything new worth tracking, remove anything that's now shipped), then run: git log -1 --format=%H -- CLAUDE.md > $MARKER_FILE && git add $MARKER_FILE ROADMAP.md && git commit -m 'Sync ROADMAP.md against CLAUDE.md' && git push. Then finish normally -- this only fires again once CLAUDE.md changes further."}
EOF
else
  exit 0
fi
