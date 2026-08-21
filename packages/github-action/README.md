# Ryu GitHub Action

Use a self-hosted or managed Ryu Core node from GitHub Actions. The action validates
the node, exports reusable node variables, runs saved Ryu agents/teams/workflows, and
can invoke an allowlisted MCP/Ryu tool directly.

## Setup-only workflow

```yaml
name: Ryu setup

on: [push]

jobs:
  ryu:
    runs-on: ubuntu-latest
    steps:
      - uses: amajorai/ryu@v1
        with:
          target: managed
          managed-node-url: ${{ secrets.RYU_MANAGED_NODE_URL }}
          managed-node-token: ${{ secrets.RYU_MANAGED_NODE_TOKEN }}
          operation: setup

      - run: echo "Ryu is available at $RYU_CORE_URL"
```

`target: self-hosted` uses `node-url`/`node-token` or `RYU_CORE_URL`/
`RYU_CORE_TOKEN`. `target: managed` verifies that `/api/system/info` reports
`managed: true`. `target: auto` accepts either kind of node.

## Run an agent, team, or workflow

```yaml
- uses: amajorai/ryu@v1
  id: ryu
  with:
    target: managed
    managed-node-url: ${{ secrets.RYU_MANAGED_NODE_URL }}
    managed-node-token: ${{ secrets.RYU_MANAGED_NODE_TOKEN }}
    operation: run
    agent: review-agent
    prompt: Review the changed files and return a concise release decision.
    response-file: .ryu/review.txt

- run: cat .ryu/review.txt
- run: echo "${{ steps.ryu.outputs.response }}"
```

Use `team` or `workflow` instead of `agent`; the three selectors are mutually
exclusive. Existing Ryu tools configured for the selected agent/team/workflow remain
available through Core's normal allowlist and approval rules.

Runs do not persist conversations or enable long-term memory unless `persist: true`
or `enable-long-term: true` is set. A remote node cannot see the GitHub runner's
filesystem, so set `cwd` only when the targeted Core process can access that path.

## Call a direct tool

```yaml
- uses: amajorai/ryu@v1
  id: ryu-tool
  with:
    node-url: ${{ secrets.RYU_NODE_URL }}
    node-token: ${{ secrets.RYU_NODE_TOKEN }}
    operation: tool
    agent: release-agent
    tool: exa.search
    tool-arguments: '{"query":"Ryu release notes"}'

- run: echo '${{ steps.ryu-tool.outputs.result-json }}'
```

Direct calls require an agent because Core uses that agent's configured tool
allowlist. A denied or failed call fails the action.

## Inputs and outputs

The complete input/output contract is declared in the repository-root `action.yml`.
Tokens are masked before requests run and are never logged by the action. The optional
`write-summary` report contains only operation/node metadata; response text is exposed
through `response`, `result-json`, and `response-file`.
