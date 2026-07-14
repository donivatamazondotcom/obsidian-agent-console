## Description

<!-- What did you change and why? -->

## Related issue

<!-- e.g., Closes #123 -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor
- [ ] Other

## Checklist

- [ ] `npm run lint` passes ("Use sentence case for UI text" errors are acceptable for brand names)
- [ ] `npm run build` passes
- [ ] Tested in Obsidian
- [ ] Existing functionality still works
- [ ] Documentation updated if needed

## Test quality (for PRs that add or modify tests)

Tick each, or state N/A with a reason in the description:

- [ ] **R1 Red-first:** the test fails against the pre-fix/pre-feature code (cite the failing output for bug fixes)
- [ ] **R2 Boundary honesty:** the test enters at the seam the runtime uses (real send path, mount→persist→remount, public hook API) — not a private helper when a live path exists
- [ ] **R3 Outcome assertion:** asserts user-visible or persisted outcome — not only "mock was called" / "didn't throw"
- [ ] **R4 Mock budget:** mocks only at architecture boundaries (`acp/` port, settings port, Obsidian stub) — never a sibling module of the code under test
- [ ] **R5 No tautology:** the test does not re-implement production logic to compute its expected value

## Testing environment

- Agent: <!-- e.g., Claude Code, Codex, Gemini CLI, OpenCode -->
- OS: <!-- e.g., macOS, Windows, Linux -->

## Screenshots

<!-- If applicable, add screenshots to help explain your changes -->
