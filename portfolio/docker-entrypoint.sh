#!/bin/sh
# Container entrypoint. Brings up Tailscale (if configured) so the
# chatroom's real Swing GUI preview can reach the chat server over it, then
# starts Flask. Entirely skipped — falls straight through to `python
# app.py` — if TAILSCALE_SERVER_AUTHKEY isn't set, so local dev and any
# deploy that hasn't set up Tailscale yet behave exactly as before this was
# added: the simulated text-protocol preview still works either way.
#
# Userspace networking mode (--tun=userspace-networking) is deliberate: it
# needs no /dev/net/tun device and no NET_ADMIN capability, which most
# PaaS containers (including Render) don't grant. `tailscale serve --tcp`
# then forwards straight from the tailnet into the container's own
# loopback interface — the ChatServer itself never has to bind anything
# but 127.0.0.1 (see scripts/build_preview.py's --loopback-only patch),
# so the public-internet exposure bug that started this whole thing stays
# fixed regardless of Tailscale's presence.
set -e

if [ -n "$TAILSCALE_SERVER_AUTHKEY" ]; then
    echo "Starting tailscaled (userspace networking)..."
    tailscaled --tun=userspace-networking --state=/tmp/tailscaled.state &

    echo "Joining tailnet as chatroom-server..."
    # --ssh omitted on purpose: no reason to expose SSH into this container
    # over the tailnet just because this feature needs a socket forwarded.
    tailscale up \
        --authkey="$TAILSCALE_SERVER_AUTHKEY" \
        --hostname="${TAILSCALE_CHATROOM_HOSTNAME:-chatroom-server}" \
        --accept-dns=false \
        --timeout=30s

    # Forward the tailnet-facing chat + file-transfer ports straight to the
    # already-loopback-bound real server. Flask spawns that server lazily
    # on first preview request (see _ensure_chatroom_network in app.py) —
    # these forwards sit idle and harmless until then.
    tailscale serve --bg --tcp=12345 tcp://localhost:12345
    tailscale serve --bg --tcp=34567 tcp://localhost:34567 || \
        echo "WARNING: couldn't serve port 34567 (file transfer/update-check) — chat itself is unaffected, that feature just won't work over the GUI preview."

    echo "Tailscale ready: $(tailscale ip -4 2>/dev/null || echo '(ip pending)')"
fi

exec python app.py
