# Adopt an existing Neo16 widget (conversation 3660)

The ordinary preset picker creates `16neo` with no installation or tables. Its
legacy renderer remains selected until an owner explicitly installs the module.
Use the module's authenticated setup endpoint for BOTH a new preset widget and an
existing URL; do not insert `__module` with a generic widget PATCH.

## Contract

`POST /api/v3/neo16/widgets/:id/install`, authenticated space owner only:

```json
{"data":{"dry_run":true}}
```

Then, after reviewing the diff:

```json
{"data":{"dry_run":false}}
```

For a space dashboard without a project, include `data.project_id`. The service
verifies that project belongs to the widget's space. For a project dashboard it
uses that dashboard's project; a different `data.project_id` is refused with
`409 PROJECT_NOT_WIDGET_PROJECT` before either phase writes. The body cannot provide a blueprint, table IDs,
actor, space or ownership tag. Zod rejects unknown fields and malformed IDs.

The dry-run returns `{dry_run, plan, installation, npc_agents}` under the standard API `data`.
`npc_agents` plans the target space’s Agents/Operators schemas, three agents and bindings.
Its `system_project` identifies the space-local System Data destination (or its
creation). Each agent table carries `project_id`, `from_project_id` and
`action: create | existing | move`; a not-yet-created destination has a null ID.
Dry-run never creates a project or moves a table.
Expect `plan.widgets[0]` to carry the original `widget_id`, `dashboard_id` and
`action: "adopt"`; seven table declarations and the quest seed are reconciled by
name. Conflicting column types, wrong preset/space/tag, another installed game URL,
and switching an existing installation's project are refused with 409. No rows are
changed by dry-run. Missing/unauthorized widgets return 404; malformed input 400.

Apply provisions tables, seed, installation and config in one transaction. Existing
rows, widget ID, title, position, public flag, owner and dashboard remain intact;
config retains custom settings and gains resolved table refs plus `__module`.
The second setup phase creates Nora, Reed and Casey in this space's ordinary
`AI Agents` table (marker `ai_agents`) and a local Codex CLI operator if absent.
Both agent registries (`AI Agents`, `AI Operators`) belong to **System Data in
the same space**, found by type `system_data` or the legacy name `System Data`.
Missing System Data is created in the agent transaction. A repeated setup moves
existing registries there without changing table/row IDs, agent settings, policies
or bindings. Multiple matching system projects or registries fail with
`AGENT_SETUP_CONFLICT` rather than selecting arbitrarily. All seven `neo16_*`
tables, including NPC memories and bindings, remain in the widget/installation
project; module uninstall does not own or purge the agent registries.
It reuses core table definitions and the existing quest personas; default model
`gpt-6-astra` is row data, editable through normal agent settings. Globally unique
slugs include the space ID. Existing local registries are reused without deleting
rows; custom agent instructions are preserved. Missing columns are added, incompatible
schemas and required custom fields without values are refused. A disabled Codex
operator or an existing conflicting NPC/evaluator binding is never silently replaced.

Agents, space-scoped deny-all tool policies and the three `agent_binding` content rows
commit in ONE second transaction. No model is invoked during setup. Agent passports
are resolved by the existing fleet on first use. `NPC_SETUP_INCOMPLETE` (409) means the
module phase committed but the agent phase did not; repeat this endpoint to complete
setup, never uninstall. Dry-run preflights agent schemas before module apply.

Repeated/concurrent calls do not duplicate authoritative records. There is one
`game` widget per Neo16 installation/space: if another URL already owns it, stop
and let the owner choose; do not delete or silently replace that widget.

After apply, refetch the widget row and render it. UI should show owner setup for
uninstalled widgets and an explanatory state for other roles, instead of silently
launching the legacy office. Setup must be an explicit mutation, never triggered
on render. The frontend integration is separate from this backend slice.

## Staging 4376 — pinned preflight and execution

Read-only inspection on 2026-10-07: `dev.godcrm.ai`, actual DB `godcrm_test`, widget
4376, dashboard 7739, project 8427, space 7829. Dashboard `space_id` is NULL: project
ownership must resolve via `projects.space_id`. Widget config is `{}`. No Neo16
installation or Neo16 tables exist in that space. Runtime was based on main
`87116a3cf4505364fa83a79a65c02c582e13a34d`; that version lacks this setup endpoint.

1. Integrator deploys the committed backend through the normal staging process;
   record the resulting SHA, build/gate evidence and actual database identity.
2. Read widget 4376 and dashboard 7739 again; stop if owner/project/preset differs.
   Save the complete widget config/metadata as recovery evidence. Inspect current
   installation and current table schemas/row counts; any new table or installation
   since preflight requires review. Do not overwrite a competing installation.
3. Call `/api/v3/neo16/widgets/4376/install` with the dry-run body. Require target
   ID 4376/dashboard 7739, seven intended module tables plus the local Agents/Operators plan, no conflicts, no widget creation
   and no default-dashboard creation. Save the exact plan and schema evidence.
4. Apply once with the same URL and `dry_run:false`. Re-read widget, installation,
   all seven module column schemas, Agents/Operators schemas and row counts. Check ownership tag and every table ID,
   original URL/metadata, one installation, no duplicate widget and retained rows.
5. Verify the returned `npc_agents`: three agent rows in this space, local operator,
   three NPC bindings and deny-all tool policies. Confirm model/operator/personas via
   the ordinary Agents table. The default follows the prior owner choice of Astra on
   Codex CLI. Runtime authentication and the permission hook must work on staging;
   setup does not copy credentials or enable a CLI. See the agent runner section of
   `README.md`. Do not insert `{evaluator:"rules"}` as a substitute for live AI.
6. Perform the browser acceptance below, keeping evidence on the exact resulting SHA.

Do not run module uninstall as rollback: an adopted widget is now module-owned and
uninstall removes its URL. If activation must be reverted, restore the saved full
widget config via the normal authenticated widget API after checking no intervening
edit, and retain installation/tables/learner rows and the local agents/policies for recovery. No delete/purge or
runtime restart is part of this data operation. This rollback is NOT TESTED live.

## Acceptance — exactly https://dev.godcrm.ai/widgets/4376

- Logged-in authorized user opens this URL and sees Town, not the office.
- Town loads residents; move using a tile and keyboard. Confirm the player position
  changes from the server response; reload preserves the same learner/world.
- Approach Nora/Reed, open dialogue, send a utterance through the selected real CRM
  agent. Verify a real response, no binding/policy error and no leaked runtime data.
- Complete the quest, record progress/XP, reload and verify dialogue and progress.
- A second user cannot read the first learner's world/session; unauthenticated
  access to the private world API remains denied even when widget.is_public is true.
- Repeat setup and verify no new widget/tables, unchanged learner progress.
- Repeat the UI creation path for a new Neo16 in a separate staging fixture space:
  explicit install → city, not a fresh uninstalled legacy office. Remove only the
  fixture objects created for that test, recording cleanup evidence.

Local API/DB tests prove movement, NPC content, dialogue and progress using an
explicit rule-evaluator fixture. They do NOT prove browser/live AI acceptance at
4376. Staging conversion, UI wiring, real agent execution and that exact-URL acceptance
remain pending deployment. Full AI Town graphics (tile art, sprites, environment)
remain OPEN: the currently shipped Town is a 16×16 grid with letter NPCs.

Validation uses the installed Zod 3 contract: https://v3.zod.dev/?id=records.
