---
layout: home

hero:
  name: "Agent Console"
  text: "Finally put your second brain to work."
  tagline: "Agent Console connects your vault to the best AI models. Point them at the notes that matter – they follow the links to see the full picture, then help you build: docs, slides, projects, even code. Everything you work out gets saved back to your notes – so each new project starts further ahead than the last."
  image:
    src: /images/multi-session-animated.gif
    alt: Three agent sessions in parallel tabs beside an open note in Obsidian – each tab keeps its own conversation and status icon
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
    details: Agents work from the notes you've already written. @mention a note and they read it – plus the notes it links to – so the answers fit your world, not generic advice off the internet. Your own knowledge is the starting point, never a blank chat.
  - icon: 🌱
    title: Your Second Brain Pays You Back
    details: Agents don't just read – they write back. Let one capture decisions and draft notes as you work, so what you figure out lands back in your vault. Each project leaves your notes richer for the next.
  - icon: 🤖
    title: Any Agent, Several at Once
    details: Claude Code, Codex, Gemini CLI, Kiro CLI, or any custom ACP-compatible agent. Run several side by side in a tabbed sidebar – each tab its own session, surviving an Obsidian restart and connecting to its agent only when you start typing. On a fresh install it defaults to an agent you already have installed, so your first chat just works. Close the panel with multiple chats open and it checks before dropping them all.
  - icon: 💻
    title: See and Approve What Runs
    details: When an agent runs a command, you see it and its output right in the chat – and anything that touches your system waits for your approval first. No black-box actions.
  - icon: 🪶
    title: Context Budget Goes Further
    details: Pinned notes are referenced, not re-pasted into every message – so a long multi-turn chat uses 65–80% fewer context tokens than re-sending a note's full content each turn. More window left for the actual work.
  - icon: 🎛️
    title: A Model for Every Task
    details: Run a fast model in one tab and a heavyweight one in another. Switch model or mode mid-conversation – each tab keeps its own choice, so the right tool is always one tab away.
  - icon: 🔍
    title: Search Your History
    details: Find that conversation you half-remember. Search across every past chat by title or by what was actually said inside it, then reopen any session in a tab and pick up right where it left off.
  - icon: 📥
    title: Bring Your Setup With You
    details: Switching from another agent plugin? Import its agent definitions, defaults, and API keys in one click. Agent Console offers it on first run and keeps your keys where they already live.
  - icon: 🎨
    title: Native & Theme-Friendly
    details: Agent Console adopts Obsidian’s native styling and theme variables instead of hardcoded colors and chrome, so it looks like part of your Obsidian and adapts to any custom theme.
  - icon: 🛡️
    title: Enterprise-Grade Quality
    details: "Built with the rigor you'd expect from enterprise software: 700+ automated tests, lint and build checks on every change, a token-efficiency benchmark you can run yourself, and performance tracked against a baseline – so updates stay solid as the plugin grows."
---

<p align="center"><em>Agent Console was built start to finish this way – the plugin is its own proof.</em></p>

## What is Agent Console?

Agent Console is an Obsidian plugin built on the [Agent Client Protocol (ACP)](https://github.com/zed-industries/agent-client-protocol). It brings AI agents into your vault, where your notes live. Instead of starting from a blank chat, an agent draws on the notes you've already written – and writes new ones back – so it works from your own knowledge whether you're researching, drafting, planning, or vibe-coding. Run several at once in a tabbed sidebar, so you can keep working while agents work.

Agent Console is based on [Agent Client](https://github.com/RAIT-09/obsidian-agent-client) by [@RAIT-09](https://github.com/RAIT-09), originally released under Apache-2.0. See [NOTICE](https://github.com/donivatamazondotcom/obsidian-agent-console/blob/main/NOTICE) for full attribution.

### Supported Agents

| Agent | Provider | Integration |
|-------|----------|-------------|
| **[Claude Code](https://github.com/anthropics/claude-code)** | Anthropic | via [ACP adapter](https://github.com/agentclientprotocol/claude-agent-acp) |
| **[Codex](https://github.com/openai/codex)** | OpenAI | via [Zed's adapter](https://github.com/zed-industries/codex-acp) |
| **[Gemini CLI](https://github.com/google-gemini/gemini-cli)** | Google | with `--experimental-acp` option |
| **[Kiro CLI](https://kiro.dev)** | Amazon | via built-in ACP support |
| **Custom** | Various | [Any ACP-compatible agent](https://agentclientprotocol.com/overview/agents) (e.g., OpenCode, Qwen Code) |

### What you can do

- **Turn a rough outline into a finished draft** – open a note, start a chat, and ask the agent to expand your bullet points into prose.
- **Interrogate your own vault** – ask about the note you're in; the agent reads it as context and answers in place.
- **Vibe-code a script or tool** – describe what you want, get working code back, and review the diff.
- **Keep a working log** – let an agent capture decisions and action items as you talk a problem through.
- **Run parallel trains of thought** – keep one tab digging into research while another drafts the summary.
- **Line up your next message while the agent works** – type your follow-up and press Enter; it queues and sends the moment the current reply finishes, so you never wait on the cursor.

### Why parallel?

AI agents work asynchronously. Tell one to research, another to draft a section, a third to fix a script. Switch tabs while they work. Status icons show what each agent is doing – ready, busy, waiting on you, or stuck. Stop the context-switch tax of waiting for one agent before starting the next.

The mental model: tell agents *what work to do*, not *how to do it*. With the right [skills](https://agentskills.io/home), agents figure out the steps. You stay focused on the work itself, with several streams progressing at once.

Ready to get started? Check out the [Installation Guide](/getting-started/).
