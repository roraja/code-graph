# CodeGraph Navigator

Explore CodeGraph scenarios, walk through traced execution paths, browse code walks as notebook-style cells, and inspect functions — all from the VS Code sidebar.

![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-blue?logo=visual-studio-code)
![License](https://img.shields.io/github/license/roraja/code-graph)
![Release](https://img.shields.io/github/v/release/roraja/code-graph?include_prereleases)

## Quick Install

**Linux / macOS:**
```bash
curl -fsSL "$(curl -s https://api.github.com/repos/roraja/code-graph/releases/latest | grep browser_download_url | cut -d '"' -f 4)" -o /tmp/codegraph-navigator.vsix && code --install-extension /tmp/codegraph-navigator.vsix && rm /tmp/codegraph-navigator.vsix
```

**Windows (PowerShell):**
```powershell
$url = (Invoke-RestMethod https://api.github.com/repos/roraja/code-graph/releases/latest).assets[0].browser_download_url; Invoke-WebRequest -Uri $url -OutFile "$env:TEMP\codegraph-navigator.vsix"; code --install-extension "$env:TEMP\codegraph-navigator.vsix"; Remove-Item "$env:TEMP\codegraph-navigator.vsix"
```

This downloads the latest `.vsix` from GitHub Releases and installs it into VS Code. Reload VS Code after installation.

### Alternative: Manual Install

1. Go to [Releases](https://github.com/roraja/code-graph/releases/latest)
2. Download the `.vsix` file
3. Run: `code --install-extension codegraph-navigator-*.vsix`

## What It Does

Open a workspace with a `.codegraph.yaml` config file and the CodeGraph Navigator sidebar activates automatically. From there you can:

- **Browse scenarios** — view discovered usage scenarios with status, tags, and step counts
- **Walk traced steps** — step through execution paths with source file navigation
- **Inspect step details** — see AI-generated justifications, variable values, and branch decisions
- **View call stacks** — explore the call hierarchy at each step
- **Browse functions** — search and filter indexed functions, find callers/callees
- **Code walks** — browse notebook-style cells that trace execution paths with narrative explanations
- **Right-click context** — discover scenarios or find callers/callees for any symbol in the editor

## Prerequisites

- A running CodeGraph server (`codegraph serve`) at `http://localhost:3000`
- A workspace with a `.codegraph.yaml` configuration file

## Commands

| Command | Description |
|---------|-------------|
| Refresh Scenarios | Reload scenarios from the server |
| Filter Scenarios | Filter by tags |
| View Scenario | Show scenario details |
| Walk Scenario | Step through traced execution |
| Trace Scenario | Trigger AI tracing for a scenario |
| Open Code Walk | Browse code walk cells |
| Search Functions | Search indexed functions |
| Find Callers | Find functions that call the selected symbol |
| Find Callees | Find functions called by the selected symbol |
| Discover Scenarios | Discover scenarios starting from a function |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `codegraph.autoOpenStep` | `true` | Automatically open the source file when stepping through a scenario |

## Development

```bash
# From the repository root
npm install
npm run build

# Or build just the extension
cd codegraph-navigator
npm run build
```

### Releasing

1. Update `version` in `codegraph-navigator/package.json`
2. Commit and push
3. Tag and push: `git tag v0.5.0 && git push origin v0.5.0`
4. GitHub Actions builds the VSIX and creates a release automatically

## License

[MIT](LICENSE)
