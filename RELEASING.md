# Releasing Agent Console

The release pipeline is automated via [`.github/workflows/release.yaml`](./.github/workflows/release.yaml). Pushing a version tag triggers the build, attests provenance, and creates a draft GitHub Release with `main.js`, `manifest.json`, and `styles.css` attached. The maintainer reviews the draft, adds release notes, and publishes it.

## Recipe

```bash
# 1. On main, up to date
git checkout main
git pull --ff-only

# 1b. Perf gate (Gate B-v1, warn-only): surface any perf regression vs the
#     committed baseline before releasing. Phase 1 warns, does not block.
npm run gate

# 2. Bump version. Auto-updates manifest.json + package.json + versions.json
#    via version-bump.mjs. Use: patch | minor | major
npm version patch -m "chore: release v%s"

# 3. Push commit + tag together
git push --follow-tags origin main

# 4. CI builds and creates a draft release with the 3 assets
#    Watch: https://github.com/donivatamazondotcom/obsidian-agent-console/actions

# 5. Once CI completes, edit notes and publish the draft
gh release view v<x.y.z> --web
#    Add release notes (template below), click Publish release
```

BRAT users auto-pick up the new version within ~24h, or via "Check for updates".

## Versioning

Semver, fork-independent of upstream:

- **Patch** (1.0.x): bug fixes only, no new features, no breaking changes
- **Minor** (1.x.0): new features, backward compatible
- **Major** (x.0.0): breaking changes (rare; e.g., default folder names changing, plugin id changing)

Bump `minAppVersion` in `manifest.json` only when adopting a newer Obsidian API. `version-bump.mjs` keeps `versions.json` in sync automatically.

## Release notes template

Use this in the GitHub Release notes when publishing the draft:

```markdown
## What's new

- **<feature>** – <one-sentence value statement>

## Bug fixes

- Fixed <issue>: <one-line description> (#<PR number>)

## Contributors

Thanks to @<contributor> for <contribution>.

## Install

Via [BRAT](https://github.com/TfTHacker/obsidian42-brat): `donivatamazondotcom/obsidian-agent-console`
```

## Hotfix

For urgent fixes (broken release, security):

1. Branch from `main`: `git checkout -b fix/<short-name>`
2. Apply fix, commit, push, optionally PR for CI verification
3. Merge to `main`
4. Run the standard release recipe above with `npm version patch`

## Recovery: workflow didn't run

If the CI release workflow doesn't fire on a tag push:

1. Check Actions are enabled: https://github.com/donivatamazondotcom/obsidian-agent-console/settings/actions
2. Manually trigger via the Actions tab → Release workflow → Run workflow on `main`, OR
3. Manual fallback:
   ```bash
   npm run build
   gh release create v<x.y.z> main.js manifest.json styles.css \
     --title "v<x.y.z>" --draft
   ```
   (Then edit notes and publish in the web UI.)
