---
layout: home

hero:
  name: "Agent Console"
  text: "The AI agent plugin built for Obsidian power users."
  tagline: "Run Claude Code, Codex, Kiro CLI, or any ACP agent on your notes. Stop retyping prompts and pasting context. Keep your go-to prompts as notes, open one from a bookmark on any page, and jump back into a chat from a link."
  image:
    src: /images/multi-session-animated.gif
    alt: Agent Console switching between three chats on its vertical tab rail – a Japan trip plan, a release check, and a newsletter draft – with saved-prompt chips above the composer
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/
    - theme: alt
      text: View on GitHub
      link: https://github.com/donivatamazondotcom/obsidian-agent-console

features:
  - icon: 📨
    title: Hand Any Page to Your Saved Prompts
    details: Reading an email in your browser? Select the part you care about, click a bookmark, and your "draft a reply" prompt opens in a new chat with that text in it. Every saved prompt has its own obsidian:// link, so scripts can start one too. Links wait for Enter, except a plain link to a prompt you set to auto-run.
  - icon: ⚡
    title: Prompts That Show Up Where They Fit
    details: Keep the prompts you retype, like "debrief this meeting", as notes you can edit, version, and share. A "show when" property puts a prompt's chip only on the notes it fits, like your meeting notes, and each prompt can pick its own agent and mode. Fire one from the chip or a ! search.
  - icon: 🧷
    title: Every Chat Has an Address
    details: Right-click a chat's tab and choose "Copy link to chat" to get its obsidian:// link. Paste it into a meeting note, a to-do in your task app, or a project page, and one click opens that chat in Obsidian. A link opens only chats in your vault's history and never sends a message.
  - icon: 🪶
    title: Context Budget Goes Further
    details: A pinned note goes to the agent in full with your first message, so it can start right away. After that it's sent as a link instead of being pasted again every turn, so a long chat uses 62–77% fewer context tokens than re-sending the note each time. That leaves more of the window for the work.
  - icon: 🧠
    title: Grounded in Your Notes
    details: Agents work from the notes you've already written. @mention a note and the agent reads it, and it can follow the links to related notes, so answers fit your world instead of generic advice. Paste or attach images and files too.
  - icon: 🌱
    title: Your Second Brain Pays You Back
    details: Agents can write back, too. Ask one to turn a meeting note into action items, capture a decision, or draft a page, and the result lands in your vault. Each project leaves your notes richer for the next.
  - icon: 👀
    title: See Which Chat Needs You
    details: Every tab's icon shows what its agent is up to – busy, waiting on you, finished while you were away, stopped early, or your last message failed. New installs put the tabs in a slim column of icons on the side, so every chat's status shows at once. Drag it wider for names, or put the tabs back on top.
  - icon: 🗂️
    title: Keep Several Jobs Going
    details: Start research in one tab, a draft in another, and a script fix in a third, then keep working while they run. Each tab keeps its own session, model, and mode, so a fast model can work beside a heavyweight one. A tab idle for an hour puts its agent to sleep to free memory and wakes when you type.
  - icon: 🧵
    title: Redirect Without Starting Over
    details: Type your next message while the agent is still replying and press Enter, and it sends the moment the reply finishes. Heading the wrong way? Press Cmd+Enter (Ctrl+Enter on Windows and Linux) to stop the reply and send your correction instead, and the agent keeps the whole conversation.
  - icon: 📥
    title: Bring Your Setup With You
    details: Switching from Agent Client? Import its agent definitions, defaults, and API keys in one click. Agent Console offers it on first run and keeps your keys in Obsidian's keychain, where their values are never shown.
  - icon: 🔍
    title: Your Chats Come Back
    details: Tabs and chats come back after a restart, and a closed chat is one command away. Search every past chat by title or by what was said in it, then pick up where you left off. Past the limit you set, the least recently used chat goes to the trash instead of being deleted, so its transcript isn't lost.
  - icon: 🔘
    title: Answer With One Click
    details: When an agent offers you a choice, like minimal fix or full refactor, it can show buttons right in the reply. Click one and your pick is sent as a visible, ordinary message. Buttons are drawn by the plugin in your theme, and agents can't inject styling, links, or code.
  - icon: 🔗
    title: Every Shared Link, One Click Away
    details: As the agent points you at notes and web pages, they collect in a link list in the chat header – with files it just created this session set apart from ones that already existed. Jump back to anything it shared without scrolling the conversation.
  - icon: 🤖
    title: Use the Agent You Already Have
    details: Bring Claude Code, Codex, Kiro CLI, OpenCode, Antigravity CLI, Gemini CLI, or any agent built on the Agent Client Protocol. A fresh install picks one it finds on your machine, so your first chat connects without a trip to settings. Switch a chat to another agent and the conversation comes along, in a block you can collapse.
  - icon: 💻
    title: See and Approve What Runs
    details: Commands an agent runs show in the chat with their output. When an agent asks before it edits a file or runs a command, you see what it wants and choose Allow or Reject. With Kiro CLI, a service that needs you to sign in shows where its sign-in page leads, and nothing opens until you click.
  - icon: 🧭
    title: Agents That Know They're in Obsidian
    details: From the first message, each agent is told it's in Obsidian, that its replies render links, math, and diagrams, and that it can work with your notes when the chat runs in your vault. You choose exactly what it's told. The panel uses your theme's colors and styling, so it looks like part of Obsidian.
  - icon: 🌐
    title: Use It in Your Language
    details: Agent Console follows the language you set for Obsidian – Korean, Chinese, and Japanese alongside English. Settings, notices, dialogs, the chat panel, and command names all localize, and it can ask the agent to reply in your language too. Leave it on Auto or pick one under Appearance & notifications.
  - icon: 🛡
    title: Fixes That Stay Fixed
    details: 6,000+ automated tests, and when something breaks, the fix ships with a test that reproduces it first. Lint, type checks, the full test suite, and a build run on every change. You can rerun the token benchmark yourself, and a release can't ship if context handling gets more than 15% slower than its saved baseline.
---

## What is Agent Console?

Agent Console is an Obsidian plugin built on the [Agent Client Protocol (ACP)](https://github.com/zed-industries/agent-client-protocol). It brings AI agents into your vault, where your notes live. Instead of starting from a blank chat, an agent draws on the notes you've already written – and can write new ones back – so it works from your own knowledge whether you're researching, drafting, planning, or vibe-coding. Run several at once, each in its own tab, and keep working while they do.

Agent Console is based on [Agent Client](https://github.com/RAIT-09/obsidian-agent-client) by [@RAIT-09](https://github.com/RAIT-09), originally released under Apache-2.0. See [NOTICE](https://github.com/donivatamazondotcom/obsidian-agent-console/blob/main/NOTICE) for full attribution.

### Supported Agents

Use the agent you already have. A fresh install picks the first one it finds on your machine, and any agent built on the Agent Client Protocol works too.

| Agent | Provider | Integration |
|-------|----------|-------------|
| **[Claude Code](https://github.com/anthropics/claude-code)** | Anthropic | via [ACP adapter](https://github.com/agentclientprotocol/claude-agent-acp) |
| **[Codex](https://github.com/openai/codex)** | OpenAI | via the [ACP adapter](https://github.com/agentclientprotocol/codex-acp) |
| **[Kiro CLI](https://kiro.dev)** | Amazon | via built-in ACP support (V3 engine; older versions run on V2) |
| **[OpenCode](https://opencode.ai)** | Open source | via built-in ACP support (runs local models via ollama) |
| **[Antigravity CLI](/agent-setup/antigravity-cli)** | Google | via built-in ACP support (`agy acp`) |
| **[Gemini CLI](https://github.com/google-gemini/gemini-cli)** | Google | with `--experimental-acp` option (legacy – see Antigravity CLI) |
| **Custom** | Various | [Any ACP-compatible agent](https://agentclientprotocol.com/overview/agents) (e.g., Qwen Code) |

### What you can do

- **Turn a rough outline into a finished draft** – open the note, start a chat, and ask the agent to expand your bullets into prose.
- **Interrogate your own vault** – ask about the note you're in; the agent reads it as context and answers in place.
- **Vibe-code a script or tool** – describe what you want, get working code back, and review the diff.
- **Keep a working log** – let an agent capture decisions and action items as you talk a problem through.
- **Run parallel trains of thought** – keep one tab digging into research while another drafts the summary.
- **Line up your next message while the agent works** – press Enter and it sends the moment the current reply finishes.
- **Redirect the agent the moment it goes sideways** – one keypress stops the current reply and sends your correction instead, without losing the conversation.
- **Fire a saved prompt in one click** – keep recurring kickoffs as notes and launch one from a chip or a `!` search.
- **Hand an agent what you're reading** – select part of an email thread in your browser, click a bookmark, and your "draft a reply" prompt opens with that text already in it.

### Why parallel?

An agent can work for minutes on its own. Tell one to research, another to draft a section, and a third to fix a script, then switch tabs while they work. Each tab's icon shows whether its agent is busy, waiting on you, finished, or stopped early, so you start the next job instead of waiting on the last.

The mental model: tell agents *what work to do*, not *how to do it*. With the right [skills](https://agentskills.io/home), agents figure out the steps. You stay focused on the work itself, with several streams moving at once.

*Agent Console was built start to finish this way – the plugin is its own proof.*

Ready to get started? Check out the [Installation Guide](/getting-started/).
