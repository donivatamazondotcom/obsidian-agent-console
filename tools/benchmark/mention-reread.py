"""Mention re-read rate from kiro-cli session logs.

[[ACP Context Note Hydration]] § Evidence / Success Measure. For each
@[[mention]] the plugin inlined, report how often the agent read the same
note again, bucketed by note size and truncation.

Usage:
  VAULT_PATH=/path/to/vault python3 tools/benchmark/mention-reread.py [SESSIONS_DIR]

SESSIONS_DIR defaults to ~/.kiro/sessions/cli. Only files containing an
<obsidian_mentioned_note> block are scanned. Path matching is approximate:
file-read tool paths plus shell commands that name the note's file.
"""
import json, re, sys, os, statistics, datetime

VAULT = os.environ.get("VAULT_PATH", "").rstrip("/") + "/"
if VAULT == "/":
    sys.exit("set VAULT_PATH to the vault root")
D = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "~/.kiro/sessions/cli")
files = [f for f in os.listdir(D) if f.endswith(".jsonl")
         and "obsidian_mentioned_note ref=" in open(os.path.join(D, f), errors="ignore").read()]
TAG = re.compile(r'<obsidian_mentioned_note ref="file://([^"]+)">(.*?)</obsidian_mentioned_note>', re.S)

def tool_paths(b):
    """Return list of (path_or_cmd, kind, partial) touched by a toolUse."""
    n = b.get("name", ""); i = b.get("input", {}) or {}
    out = []
    if n in ("read", "fs_read", "read_file"):
        for op in i.get("operations", [i]):
            p = op.get("path", "")
            partial = any(k in op for k in ("start_line", "end_line", "offset", "limit")) and not (
                op.get("start_line") in (None, 1) and op.get("end_line") in (None, -1))
            out.append((p, "read", partial))
    elif n in ("write", "fs_write", "str_replace", "strReplace"):
        out.append((i.get("path", ""), "write", False))
    elif n in ("shell", "execute_bash", "execute_cmd"):
        out.append((i.get("command", ""), "shell", False))
    elif n in ("grep", "grep_search"):
        out.append((i.get("path", "") + " " + i.get("pattern", ""), "grep", False))
    return out

def touches(target, item):
    s, kind, _ = item
    if kind in ("read", "write"):
        return s == target or s.endswith(target[len(VAULT):]) if target.startswith(VAULT) else s == target
    if kind == "shell":
        base = os.path.basename(target)
        return base in s and any(c in s for c in ("cat ", "sed ", "head", "tail", "obsidian", "read", "python", "awk", "grep"))
    return False

rows = []
for f in files:
    try:
        recs = [json.loads(l) for l in open(os.path.join(D, f))]
    except Exception:
        continue
    turns = []  # list of (prompt_record, [toolUse blocks])
    for r in recs:
        if r.get("kind") == "Prompt":
            turns.append((r, []))
        elif r.get("kind") == "AssistantMessage" and turns:
            for b in r["data"].get("content", []):
                if b.get("kind") == "toolUse":
                    turns[-1][1].append(b["data"])
    seen = set()
    for ti, (p, _) in enumerate(turns):
        text = "".join(c.get("data", "") for c in p["data"].get("content", []) if c.get("kind") == "text")
        for m in TAG.finditer(text):
            path, body = m.group(1), m.group(2)
            if (path) in seen:
                continue  # first mention per session only
            seen.add(path)
            trunc = "Truncated from" in body
            mt = re.search(r"Truncated from (\d+)", body)
            full_len = int(mt.group(1)) if mt else len(body)
            same = [x for b in turns[ti][1] for x in tool_paths(b) if touches(path, x)]
            later = [x for t in turns[ti + 1:] for b in t[1] for x in tool_paths(b) if touches(path, x)]
            rows.append(dict(f=f, path=path, chars=len(body), full=full_len, trunc=trunc,
                             inlined=len(body.strip()) > 200,
                             same_read=any(k in ("read", "shell") for _, k, _ in same),
                             same_partial=any(pa for _, k, pa in same if k == "read"),
                             same_write=any(k == "write" for _, k, _ in same),
                             later_read=any(k in ("read", "shell") for _, k, _ in later),
                             mtime=os.path.getmtime(os.path.join(D, f))))

def pct(a, b): return f"{a}/{b} = {100*a/b:.1f}%" if b else "n/a"
inl = [r for r in rows if r["inlined"]]
print("mention events (first per session/note):", len(rows), " inlined:", len(inl))
if rows:
    print("date range:", datetime.date.fromtimestamp(min(r['mtime'] for r in rows)), "→", datetime.date.fromtimestamp(max(r['mtime'] for r in rows)))
for label, sub in [("ALL inlined", inl),
                   ("not truncated (<=10K)", [r for r in inl if not r["trunc"]]),
                   ("truncated (>10K)", [r for r in inl if r["trunc"]]),
                   ("full <=8K", [r for r in inl if r["full"] <= 8000]),
                   ("8K-16K", [r for r in inl if 8000 < r["full"] <= 16000]),
                   (">16K", [r for r in inl if r["full"] > 16000])]:
    n = len(sub)
    print(f"\n[{label}] n={n}")
    if not n: continue
    print("  re-read same turn:   ", pct(sum(r['same_read'] for r in sub), n))
    print("  edited same turn:    ", pct(sum(r['same_write'] for r in sub), n))
    print("  re-read w/o edit:    ", pct(sum(r['same_read'] and not r['same_write'] for r in sub), n))
    print("  re-read any later:   ", pct(sum(r['later_read'] for r in sub), n))
    print("  never touched again: ", pct(sum(not r['same_read'] and not r['same_write'] and not r['later_read'] for r in sub), n))
    print("  median full chars:   ", int(statistics.median(r['full'] for r in sub)))
