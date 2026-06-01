# Welcome

This is a fixture vault for screenshot automation. It provides consistent content for capturing documentation screenshots of the Agent Console plugin.

## Features

- Multi-session chat management
- Floating chat view
- Ribbon icon quick access

## Code Example

```typescript
const plugin = new AgentConsolePlugin(app, manifest);
await plugin.onload();
```

## Notes

Use this vault with `npm run docs:screenshots` to regenerate documentation images reproducibly.
