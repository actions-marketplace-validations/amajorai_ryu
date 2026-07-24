# Workflow template blueprints

One JSON document per curated template. `../templates.rs` `include_str!`s each of
these into `TEMPLATE_FILES` and derives `catalog()` from them, so the blueprints
ship **inside** the Core binary with no filesystem dependency at runtime — the
same embedding the plugin manifest fixtures use
(`plugin_manifest/fixtures/*.manifest.json`).

## File shape

Exactly the serde image of `WorkflowTemplate`:

```jsonc
{
  "meta":    { "id", "name", "description", "category", "pattern", "icon",
               "node_count", "tags", "source_url"? },
  "primary": <Workflow>,
  "bodies":  [ ["<placeholder_id>", <Workflow>] ]
}
```

- `meta.id` must equal the file's base name (`find()` keys off `meta.id`; a test
  asserts the pair).
- `meta.category` is one of `research`, `orchestration`, `quality`, `automation`.
- `meta.node_count` must equal `primary.nodes.len()` (it is the card's complexity
  hint, and a test asserts it — it is not derived at load time so the listing
  endpoint stays a pure metadata read).
- A `Workflow`'s `triggers` / `created_at` / `updated_at` are `#[serde(default)]`
  and are omitted here: a template is never a persisted workflow. Install mints
  fresh `wf_<uuid>` ids and saves through `persist_workflow`, which is where
  triggers reconcile.
- `bodies` exists because a durable `While` needs its body as a *separate*
  workflow. The placeholder id (e.g. `eo_refine_body`) appears as the `While`
  node's `body_workflow_id` and is rewritten to the minted id on install.

## Adding a template

Drop a `<id>.json` here and add one `include_str!` line to `TEMPLATE_FILES`. The
order of that list **is** the display order the desktop store section renders, so
appending puts the template last. No other Rust changes.

## Non-obvious blueprint decisions

- **`evaluator-optimizer`** — the durable `while` carries a *single* value between
  iterations, and a body sub-run cannot read the parent's other nodes. So the loop
  carries the DRAFT itself and each iteration folds the evaluator and the optimizer
  into one step: critique the current draft, rewrite it addressing the critique,
  emit the improved draft (which becomes the next carry). Bounded by
  `max_iterations`; the final carry is the refined work. Splitting it back into
  separate evaluate/optimize nodes would lose the critique between iterations.
- **`autoresearch`** — the agent task text is the operating manual for the
  `research__*` sidecar tools (init workspace → read → edit → run → keep/reset →
  ledger). Editing the numbered steps changes what the researcher actually does.
