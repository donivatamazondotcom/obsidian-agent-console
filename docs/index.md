---
layout: home

hero:
  name: "Agent Console"
  text: "Your AI agents, working from your notes."
  tagline: "They can also save what they figure out back to your vault – a plan, a draft, a meeting's action items. Run several at once."
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
  - icon: 🧠
    title: Grounded in Your Notes
    details: Agents work from the notes you've already written. @mention a note and the agent reads it, and it can follow the links to related notes, so answers fit your world instead of generic advice. Send PDFs and images to the agent by copy-pasting them or with the attach button.
  - icon: 🌱
    title: Your Second Brain Pays You Back
    details: Agents can write back, too. Ask one to turn a meeting note into action items, capture a decision, or draft a page, and the result lands in your vault. Each project leaves your notes richer for the next.
  - icon: ⚡
    title: One-Click Kickoffs
    details: Keep the prompts you retype, like "debrief this meeting" or "summarize the selection", as notes you can edit, version, and share. Fire one from a chip or a ! search. A "show when" property puts a prompt's chip only on the notes it fits, and each prompt can pick its own agent and mode.
  - icon: 📨
    title: Hand Any Page to Your Saved Prompts
    details: Reading an email thread in your browser? Select the part you care about, click a bookmark, and your "draft a reply" prompt opens in a new chat with that text in it. Every saved prompt has its own obsidian:// link, so scripts can start one too. A link waits for Enter unless it's a plain link to a prompt you explicitly set to auto-run.
  - icon: 👀
    title: See Which Chat Needs You
    details: Every tab's icon shows what its agent is up to – busy, waiting on you, finished while you were away, stopped early, or your last message failed. New installs put the tabs in a slim column of icons on the side, so every chat's status shows at once. Drag it wider for names, or put the tabs back on top.
  - icon: 🗂️
    title: Keep Several Jobs Going
    details: Start research in one tab, a draft in another, and a script fix in a third, then keep working while they run. Each tab is its own session and names itself from what you're working on. A tab you haven't touched in an hour puts its agent to sleep to free memory and wakes when you type.
  - icon: 🤖
    title: Use the Agent You Already Have
    details: Bring Claude Code, Codex, Kiro CLI, OpenCode, Antigravity CLI, Gemini CLI, or any agent built on the Agent Client Protocol. A fresh install picks one it finds on your machine, so your first chat connects without a trip to settings. Switch a chat to another agent and the conversation comes along, in a block you can collapse.
  - icon: 💻
    title: See and Approve What Runs
    details: Commands an agent runs show in the chat with their output. When an agent asks before it edits a file or runs a command, you see what it wants to do and choose Allow or Reject. When a connected service needs you to sign in, the prompt shows where the sign-in page leads, and nothing opens until you click.
  - icon: 🔍
    title: Your Chats Come Back
    details: Tabs and chats come back after a restart, and a closed chat is one command away. Search every past chat by title or by what was said in it, then pick up where you left off. Past the limit you set, the least recently used chat goes to the trash instead of being deleted, so its transcript isn't lost.
  - icon: 🪶
    title: Context Budget Goes Further
    details: A pinned note goes to the agent in full with your first message, so it can start right away. After that it's sent as a link instead of being pasted again every turn, so a long chat uses 62–77% fewer context tokens than re-sending the note each time. That leaves more of the window for the work.
  - icon: 🎛️
    title: A Model for Every Task
    details: Run a fast model in one tab and a heavyweight one in another. Switch model or mode mid-conversation – each tab keeps its own choice, so the right tool is always one tab away.
  - icon: 🧭
    title: Agents That Know They're in Obsidian
    details: From the first message, each agent gets a short system prompt about its surroundings – that it's in Obsidian, that its replies render links, math, and diagrams, and that it can work with your notes when the chat runs in your vault. It acts native out of the box, and you choose exactly what it's told.
  - icon: 🔘
    title: Answer With One Click
    details: When an agent offers you a choice, like minimal fix or full refactor, it can show buttons right in the reply. Click one and your pick is sent as a visible, ordinary message. Buttons are drawn by the plugin in your theme, and agents can't inject styling, links, or code.
  - icon: 🌐
    title: Use It in Your Language
    details: Agent Console follows the language you set for Obsidian – Korean, Chinese, and Japanese alongside English. Settings, notices, dialogs, the chat panel, and command names all localize, and it can ask the agent to reply in your language too. Leave it on Auto or pick one under Appearance & notifications.
  - icon: 🔗
    title: Every Shared Link, One Click Away
    details: As the agent points you at notes and web pages, they collect in a link list in the chat header – with files it just created this session set apart from ones that already existed. Jump back to anything it shared without scrolling the conversation.
  - icon: 📥
    title: Bring Your Setup With You
    details: Switching from another agent plugin? Import its agent definitions, defaults, and API keys in one click. Agent Console offers it on first run and keeps your keys where they already live.
  - icon: 🎨
    title: Native & Theme-Friendly
    details: Agent Console adopts Obsidian's native styling and theme variables instead of hardcoded colors and chrome, so it looks like part of your Obsidian and adapts to any custom theme.
  - icon: 🛡️
    title: Enterprise-Grade Quality
    details: 5,000+ automated tests, and when something breaks, the fix ships with a test that reproduces it first. Lint, type checks, the full test suite, and a build run on every change. You can rerun the token benchmark yourself, and a release can't ship if context handling gets more than 15% slower than its saved baseline.
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
