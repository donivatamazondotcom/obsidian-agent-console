# Times in the chat

Come back to a chat and see at a glance when you asked, when the agent finished, and how long it took. Agent Console adds small, faint times to the chat so you can tell whether an answer is 30 seconds or 30 minutes old, without them getting in the way.

## When you sent each message

Each message you send shows the time you sent it, just below it on the right. A message you queue while the agent is busy or still connecting shows the time it was actually sent, not the time you typed it.

## When a reply finished, and how long it took

When the agent finishes a reply, the time it finished and how long it worked appear under the reply, for example `9:18 AM · 6m`. When that working time is under a second, the time shows alone. The time the agent spent waiting for you to approve something is left out, so the number is how long the agent itself worked.

- A reply you stopped says so: `Stopped 9:49 AM · 18m`.
- A reply that failed says so: `Failed 9:49 AM`.
- When the agent sent nothing back, the finish time shows under your message instead.
- A reply that is still running shows no finish time yet.

## Where the agent went quiet

When something shows up in a reply after more than a minute of silence, it gets a time of its own above it. That marks where the agent paused, for example while a long command ran. Short pauses get no time, so busy replies stay uncluttered.

## While the agent works

While a reply is running, the line under the chat tells you how long the agent has been at it and when you last heard from it, for example `Working 4m · last update 10s ago`. Before anything comes back it reads `Working 1m · no update yet`. While a tool runs, the line names it: `Running npm test · 5m`.

When the agent asks for your approval, the line reads `Waiting on you`. Time spent waiting for you is left out of every count.

Agent Console doesn't guess whether an agent is stuck. A quiet agent can be thinking, and a quiet command can be a test run writing to a log, so the line shows the facts and leaves the call to you. A `last update` that keeps growing is your cue to look.

## How long each tool ran

Every tool call shows its time at the right of its row. A finished row shows how long it ran, for example `1m 52s`. Hover over the row to see when it started and ended.

While a tool runs, its row shows how long it has been running, plus what Agent Console can see of it:

- A command Agent Console runs for the agent: `1m 10s · output 2s ago`, `6m · no output yet` before it prints anything, or `6m · exited 1m ago` once it has finished.
- A tool the agent runs itself that sends its output along (Codex does): `1m 10s · output 2s ago`.
- Any other tool the agent runs itself: how long it has been running, for example `6m`.

A tool that was still open when the reply ended shows a stop icon instead of a clock: `Stopped · 1m 10s` when you stopped the reply, or `Open at turn end · 1m 10s` when it ended another way. An exported chat says the same.

## When a reply's text started arriving

Hover over a reply to see when its text started arriving, next to the **Copy** button.

## How long ago

Hover over any time to see how long ago it was, for example `9:36 AM — 13 minutes ago`.

## Dates

A time from today shows just the clock time. A time from an earlier day also shows the date (`Nov 14, 9:18 AM`), and a time from an earlier year also shows the year (`Nov 14, 2025, 9:18 AM`). If you leave a chat open past midnight, its times update to show the date.

Times use your computer's language and region settings for the clock format.

## Older chats

Chats saved before this feature, and conversations loaded back from the agent instead of from your vault, don't show times. Agent Console only shows a time when it knows it is right.
