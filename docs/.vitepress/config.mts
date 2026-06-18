import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Agent Console",
  description:
    "Obsidian as your console for parallel agent work. Run multiple ACP-compatible agent sessions in tabs.",

  // GitHub Pages base path
  base: "/obsidian-agent-console/",

  // Show each page's last-updated date (per-page docs freshness signal)
  lastUpdated: true,

  head: [
    ["link", { rel: "icon", type: "image/x-icon", href: "/obsidian-agent-console/favicon.ico" }],
    ["link", { rel: "icon", type: "image/png", sizes: "32x32", href: "/obsidian-agent-console/favicon-32x32.png" }],
    ["link", { rel: "icon", type: "image/png", sizes: "16x16", href: "/obsidian-agent-console/favicon-16x16.png" }],
    ["link", { rel: "apple-touch-icon", sizes: "180x180", href: "/obsidian-agent-console/apple-touch-icon.png" }],
    ["meta", { name: "og:type", content: "website" }],
    ["meta", { name: "og:title", content: "Agent Console for Obsidian" }],
    [
      "meta",
      {
        name: "og:description",
        content: "Your Obsidian console for parallel agent work",
      },
    ],
    [
      "meta",
      {
        name: "og:url",
        content: "https://donivatamazondotcom.github.io/obsidian-agent-console/",
      },
    ],
  ],

  themeConfig: {
    logo: "/images/logo.svg",
    nav: [
      { text: "Home", link: "/" },
      { text: "Getting Started", link: "/getting-started/" },
      { text: "Agent Setup", link: "/agent-setup/" },
      { text: "Usage", link: "/usage/" },
      { text: "GitHub", link: "https://github.com/donivatamazondotcom/obsidian-agent-console" },
    ],

    sidebar: [
      {
        text: "Introduction",
        items: [{ text: "What is Agent Console?", link: "/" }],
      },
      {
        text: "Getting Started",
        items: [
          { text: "Installation", link: "/getting-started/" },
          { text: "Quick Start", link: "/getting-started/quick-start" },
        ],
      },
      {
        text: "Agent Setup",
        items: [
          { text: "Overview", link: "/agent-setup/" },
          { text: "Claude Code", link: "/agent-setup/claude-code" },
          { text: "Codex", link: "/agent-setup/codex" },
          { text: "Gemini CLI", link: "/agent-setup/gemini-cli" },
          { text: "Kiro CLI", link: "/agent-setup/kiro-cli" },
          { text: "Custom Agents", link: "/agent-setup/custom-agents" },
        ],
      },
      {
        text: "Usage",
        items: [
          { text: "Basic Usage", link: "/usage/" },
          { text: "Note Mentions", link: "/usage/mentions" },
          { text: "Context Strip", link: "/usage/context-strip" },
          { text: "Sending Images and Files", link: "/usage/sending-images" },
          { text: "Slash Commands", link: "/usage/slash-commands" },
          { text: "Mode Selection", link: "/usage/mode-selection" },
          { text: "Model Selection", link: "/usage/model-selection" },
          { text: "Effort Level Selection", link: "/usage/thought-level-selection" },
          { text: "Session History", link: "/usage/session-history" },
          { text: "Tabbed Sessions", link: "/usage/tabbed-sessions" },
          { text: "Editing", link: "/usage/editing" },
          { text: "Chat Export", link: "/usage/chat-export" },
          { text: "Commands & Hotkeys", link: "/usage/commands" },
          { text: "Importing Settings", link: "/usage/importing-settings" },
          { text: "Context Files", link: "/usage/context-files" },
          { text: "MCP Tools", link: "/usage/mcp-tools" },
        ],
      },
      {
        text: "Help",
        items: [
          { text: "FAQ", link: "/help/faq" },
          { text: "Troubleshooting", link: "/help/troubleshooting" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "ACP Protocol Support", link: "/reference/acp-support" },
        ],
      },
    ],

    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/donivatamazondotcom/obsidian-agent-console",
      },
    ],

    footer: {
      message: "Released under the Apache 2.0 License.",
      copyright: "Copyright © 2026-present Vinod Panicker. Original work © 2025 RAIT-09 (Apache-2.0).",
    },

    search: {
      provider: "local",
    },
  },
});
