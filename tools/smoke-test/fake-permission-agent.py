#!/usr/bin/env python3
"""Fake ACP agent that raises a permission request on every prompt.

Deterministic smoke/verification fixture for the notification pipeline
(I168 rAF-flush investigation): on `session/prompt` it emits a tool_call
update, then (after a short delay so the driver can background the window)
sends a real `session/request_permission` JSON-RPC REQUEST and waits for
the user's/driver's response before ending the turn.

Prompt keywords:
  "delay=N"  -> wait N seconds before raising the permission (default 2)
  anything   -> tool_call + permission request

Run via Agent Console custom agent config:
  command: python3, args: [tools/smoke-test/fake-permission-agent.py]
"""
import json
import sys
import threading
import time

_next_id = 1000


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def notify(method, params):
    send({"jsonrpc": "2.0", "method": method, "params": params})


def respond(msg_id, result):
    send({"jsonrpc": "2.0", "id": msg_id, "result": result})


def request(method, params):
    global _next_id
    _next_id += 1
    send({"jsonrpc": "2.0", "id": _next_id, "method": method, "params": params})
    return _next_id


PENDING_PERMISSION = {}  # our request id -> prompt msg_id awaiting end_turn


def agent_text(session_id, text):
    notify(
        "session/update",
        {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": text},
            },
        },
    )


def raise_permission(session_id, prompt_msg_id, delay):
    time.sleep(delay)
    tool_id = f"fake-perm-tool-{int(time.time() * 1000)}"
    notify(
        "session/update",
        {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": tool_id,
                "title": "Write smoke-perm.md",
                "status": "pending",
                "kind": "edit",
            },
        },
    )
    req_id = request(
        "session/request_permission",
        {
            "sessionId": session_id,
            "toolCall": {"toolCallId": tool_id},
            "options": [
                {"optionId": "allow-once", "name": "Allow", "kind": "allow_once"},
                {"optionId": "allow-always", "name": "Always Allow", "kind": "allow_always"},
                {"optionId": "reject", "name": "Reject", "kind": "reject_once"},
            ],
        },
    )
    PENDING_PERMISSION[req_id] = (session_id, prompt_msg_id, tool_id)


def handle(msg):
    method = msg.get("method")
    msg_id = msg.get("id")
    params = msg.get("params") or {}

    if method == "initialize":
        respond(
            msg_id,
            {
                "protocolVersion": 1,
                "agentInfo": {"name": "fake-permission-agent", "version": "1.0"},
                "agentCapabilities": {"promptCapabilities": {}},
                "authMethods": [],
            },
        )
    elif method == "session/new":
        respond(msg_id, {"sessionId": "fake-perm-session-1"})
    elif method == "session/prompt":
        session_id = params.get("sessionId", "fake-perm-session-1")
        text = " ".join(
            c.get("text", "")
            for c in params.get("prompt", [])
            if c.get("type") == "text"
        ).lower()
        delay = 2.0
        for tok in text.split():
            if tok.startswith("delay="):
                try:
                    delay = float(tok.split("=", 1)[1])
                except ValueError:
                    pass
        agent_text(
            session_id,
            f"Raising a permission request in {delay:.0f}s — background the window now.",
        )
        threading.Thread(
            target=raise_permission, args=(session_id, msg_id, delay), daemon=True
        ).start()
        # Turn stays open until the permission response arrives (see below).
    elif method == "session/cancel":
        pass
    elif msg_id is not None and "result" in msg:
        # Response to OUR session/request_permission request.
        if msg_id in PENDING_PERMISSION:
            session_id, prompt_msg_id, tool_id = PENDING_PERMISSION.pop(msg_id)
            outcome = (msg.get("result") or {}).get("outcome", {})
            notify(
                "session/update",
                {
                    "sessionId": session_id,
                    "update": {
                        "sessionUpdate": "tool_call_update",
                        "toolCallId": tool_id,
                        "status": "completed"
                        if outcome.get("outcome") == "selected"
                        else "failed",
                        "kind": "edit",
                    },
                },
            )
            agent_text(session_id, f"Permission outcome: {json.dumps(outcome)}. DONE.")
            respond(prompt_msg_id, {"stopReason": "end_turn"})
    elif msg_id is not None:
        # Unknown request — respond empty so the client doesn't hang.
        respond(msg_id, {})


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            handle(json.loads(line))
        except Exception as e:  # noqa: BLE001 — fixture must not die mid-run
            print(f"fake-permission-agent error: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
