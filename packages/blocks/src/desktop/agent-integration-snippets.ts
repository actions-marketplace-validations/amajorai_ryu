export type AgentIntegrationSnippetLang =
	| "curl"
	| "go"
	| "python"
	| "typescript";

export const AGENT_INTEGRATION_SNIPPET_LANGS: ReadonlyArray<{
	id: AgentIntegrationSnippetLang;
	label: string;
}> = [
	{ id: "typescript", label: "TypeScript SDK" },
	{ id: "python", label: "Python" },
	{ id: "go", label: "Go" },
	{ id: "curl", label: "cURL" },
];

export interface BuildAgentIntegrationSnippetOptions {
	agentId: string;
	baseUrl: string;
	hasToken: boolean;
	language: AgentIntegrationSnippetLang;
}

/** Build a copy-ready example for the saved-agent HTTP contract. */
export function buildAgentIntegrationSnippet({
	agentId,
	baseUrl,
	hasToken,
	language,
}: BuildAgentIntegrationSnippetOptions): string {
	const agentLiteral = JSON.stringify(agentId);
	const endpointLiteral = JSON.stringify(`${baseUrl}/api/chat/stream`);

	if (language === "typescript") {
		return `import { createRyuClient } from "@ryuhq/client";

const client = createRyuClient({
  baseUrl: ${JSON.stringify(baseUrl)},
  token: process.env.RYU_TOKEN,
});

for await (const chunk of client.agents.stream(${agentLiteral}, [
  { role: "user", content: "Hello!" },
])) {
  if (chunk.type === "text") process.stdout.write(chunk.content ?? "");
}`;
	}

	if (language === "python") {
		return `import os
import requests

headers = {"Accept": "text/event-stream"}
if token := os.getenv("RYU_TOKEN"):
    headers["Authorization"] = f"Bearer {token}"

with requests.post(
    ${endpointLiteral},
    headers=headers,
    json={
        "agent_id": ${agentLiteral},
        "messages": [{"role": "user", "content": "Hello!"}],
    },
    stream=True,
    timeout=300,
) as response:
    response.raise_for_status()
    for line in response.iter_lines(decode_unicode=True):
        if line:
            print(line)`;
	}

	if (language === "go") {
		return `package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
)

func main() {
	  if err := run(); err != nil {
	    log.Fatal(err)
	  }
}

func run() error {
  payload, err := json.Marshal(map[string]any{
    "agent_id": ${agentLiteral},
    "messages": []map[string]string{{"role": "user", "content": "Hello!"}},
  })
  if err != nil {
    return err
  }
  request, err := http.NewRequest("POST", ${endpointLiteral}, bytes.NewReader(payload))
  if err != nil {
    return err
  }
  request.Header.Set("Content-Type", "application/json")
  if token := os.Getenv("RYU_TOKEN"); token != "" {
    request.Header.Set("Authorization", "Bearer "+token)
  }

  response, err := http.DefaultClient.Do(request)
  if err != nil {
    return err
  }
  defer response.Body.Close()
  if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
    return fmt.Errorf("Ryu returned %s", response.Status)
  }
  _, err = io.Copy(os.Stdout, response.Body)
  return err
}`;
	}

	const payload = JSON.stringify({
		agent_id: agentId,
		messages: [{ role: "user", content: "Hello!" }],
	});
	const escapedPayload = payload.replaceAll("'", "'\\''");
	const authLine = hasToken
		? `\n  -H "Authorization: Bearer $RYU_TOKEN" \\`
		: "";
	return `curl -N ${endpointLiteral} \\
  -H "Content-Type: application/json" \\${authLine}
  -d '${escapedPayload}'`;
}

/** Build the minimal workflow needed to run this agent in GitHub Actions. */
export function buildGitHubActionsSnippet(agentId: string): string {
	return `name: Ask Ryu

on:
  pull_request:

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: amajorai/ryu@v1
        id: ryu
        with:
          target: managed
          managed-node-url: \${{ secrets.RYU_MANAGED_NODE_URL }}
          managed-node-token: \${{ secrets.RYU_MANAGED_NODE_TOKEN }}
          operation: run
          agent: ${JSON.stringify(agentId)}
          prompt: Review this pull request and return the key findings.

      - run: echo "\${{ steps.ryu.outputs.response }}"`;
}
