# MCP Tools

AI agents can use Model Context Protocol (MCP) tools to interact with external services and perform specialized tasks.

## What is MCP?

The [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) is an open standard that allows AI agents to connect to external tools and data sources.

::: tip
MCP support and configuration depend on the agent. Refer to your agent's documentation for details.
:::

## How MCP Works

When an agent uses an MCP tool:

1. The agent decides which tool to use
2. The tool call appears in the chat
3. The tool executes and returns results
4. The agent uses the results to continue

## Viewing Tool Calls

Tool calls are displayed in the chat as a single collapsed row with:

- **Tool name**: What tool was used
- **Status**: Running, completed, or failed
- **Line count**: How many lines the call contains

Click the row to expand it and see the full detail — a file diff, terminal
output, or, for other tools (such as MCP tools and subagent calls), the tool's
raw input and output. The line count always matches what the expanded view
shows. Failed calls and pending permission requests expand automatically.

## Permissions

Some MCP tool calls may require your permission before executing. When a permission request appears, select one of the available options provided by the agent.

See [Editing](/usage/editing#permission-controls) for permission settings.
