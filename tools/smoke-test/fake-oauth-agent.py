#!/usr/bin/env python3
"""Fake ACP agent that replays kiro-cli's MCP OAuth extension notifications.

Deterministic smoke fixture for the MCP OAuth prompt surfacing feature —
kiro-cli 2.12.x does not reliably start the OAuth flow (it attempts
unauthenticated HTTP and stops; verified 2026-07-13), so this agent replays
the captured wire shapes so every plugin surface can be exercised:

  session start   -> _kiro.dev/mcp/oauth_request for sheets-fake, then
                     gmail-fake (queue-aware Notice, host line, buttons)
  prompt "done"   -> _kiro.dev/mcp/server_initialized for the oldest
                     pending server (Notice dismissal, next-in-queue)
  prompt "fail"   -> failed tool_call_update titled with a PENDING server,
                     NO error payload (real kiro shape) -> sign_in banner
  prompt "failgone" -> failed tool_call_update for a server with no
                     pending sign-in, WITH auth-shaped error text
                     -> re-authenticate banner (text-fallback path)
  anything else   -> help text

Payload shapes match live capture from kiro-cli 2.12.2 (see spec
"Verified wire contract"). Run: python3 fake-oauth-agent.py (via Agent
Console custom agent config).
"""
import json
import sys
import threading
import time

PENDING = []  # serverNames in arrival order

DEMO_URL = (
    "https://example.com/consent?server={server}"
    "&note=this-is-a-smoke-test-link-not-a-real-sign-in"
)


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def notify(method, params):
    send({"jsonrpc": "2.0", "method": method, "params": params})


def respond(msg_id, result):
    send({"jsonrpc": "2.0", "id": msg_id, "result": result})


def emit_oauth_request(session_id, server):
    PENDING.append(server)
    notify(
        "_kiro.dev/mcp/oauth_request",
        {
            "sessionId": session_id,
            "serverName": server,
            "oauthUrl": DEMO_URL.format(server=server),
        },
    )


def emit_server_initialized(session_id, server):
    if server in PENDING:
        PENDING.remove(server)
    notify(
        "_kiro.dev/mcp/server_initialized",
        {"sessionId": session_id, "serverName": server},
    )


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


def failed_tool_call(session_id, server, with_error_text):
    tool_id = f"fake-tool-{int(time.time() * 1000)}"
    base = {
        "sessionId": session_id,
        "update": {
            "sessionUpdate": "tool_call",
            "toolCallId": tool_id,
            "title": f"Running: @{server}/get_spreadsheet",
            "status": "in_progress",
            "kind": "other",
        },
    }
    notify("session/update", base)
    update = {
        "sessionId": session_id,
        "update": {
            "sessionUpdate": "tool_call_update",
            "toolCallId": tool_id,
            "title": f"Running: @{server}/get_spreadsheet",
            "status": "failed",
            "kind": "other",
            # Real kiro shape: NO rawOutput / content on failure.
        },
    }
    if with_error_text:
        update["update"]["rawOutput"] = {"error": "HTTP 401 unauthorized"}
    notify("session/update", update)


HELP = (
    "OAuth replay agent. Commands: 'done' completes the oldest pending "
    "sign-in (dismisses its prompt), 'fail' emits a failed tool call for a "
    "pending server (inline Sign in banner), 'failgone' emits an "
    "auth-shaped failure with no pending sign-in (Re-authenticate banner). "
    f"Currently pending: {', '.join(PENDING) if PENDING else 'none'}."
)


def handle(msg):
    method = msg.get("method")
    msg_id = msg.get("id")
    params = msg.get("params") or {}

    if method == "initialize":
        respond(
            msg_id,
            {
                "protocolVersion": 1,
                "agentInfo": {"name": "fake-oauth-agent", "version": "1.0"},
                "agentCapabilities": {"promptCapabilities": {}},
                "authMethods": [],
            },
        )
    elif method == "session/new":
        session_id = "fake-session-1"
        respond(msg_id, {"sessionId": session_id})

        def later():
            time.sleep(1.0)
            emit_oauth_request(session_id, "sheets-fake")
            time.sleep(0.5)
            emit_oauth_request(session_id, "gmail-fake")

        threading.Thread(target=later, daemon=True).start()
    elif method == "session/prompt":
        session_id = params.get("sessionId", "fake-session-1")
        text = " ".join(
            c.get("text", "")
            for c in params.get("prompt", [])
            if c.get("type") == "text"
        ).lower()
        if "failgone" in text:
            failed_tool_call(session_id, "drive-fake", with_error_text=True)
            agent_text(
                session_id,
                "Emitted an auth-shaped failure for drive-fake (no pending "
                "sign-in) — expect the Re-authenticate banner under it.",
            )
        elif "fail" in text:
            failed_tool_call(
                session_id,
                PENDING[0] if PENDING else "sheets-fake",
                with_error_text=False,
            )
            agent_text(
                session_id,
                "Emitted a failed tool call in the real kiro shape (no error "
                "payload) — expect the Sign in banner under it.",
            )
        elif "done" in text and PENDING:
            server = PENDING[0]
            emit_server_initialized(session_id, server)
            agent_text(
                session_id,
                f"Marked {server} as signed in — its prompt should dismiss "
                + (
                    f"and {PENDING[0]}'s prompt should surface next."
                    if PENDING
                    else "silently. Queue is now empty."
                ),
            )
        else:
            agent_text(session_id, HELP)
        respond(msg_id, {"stopReason": "end_turn"})
    elif method == "session/cancel":
        pass  # notification, nothing to do
    elif msg_id is not None:
        # Politely reject anything else that expects a response.
        send(
            {
                "jsonrpc": "2.0",
                "id": msg_id,
                "error": {"code": -32601, "message": "Method not found"},
            }
        )


def main():
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            continue
        try:
            handle(msg)
        except Exception as e:  # keep the loop alive for the smoke session
            sys.stderr.write(f"fake-oauth-agent error: {e}\n")


if __name__ == "__main__":
    main()
