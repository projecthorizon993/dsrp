# Mod porting harness

Turns Vencord's plugin list into a ranked, evidence-backed porting backlog, and gates every claim the
catalog makes about what this client does.

## Why this exists

The first version of the catalog claimed 90 of 166 mods were ported. Exactly one was. Nothing about
that was a compiler error, because the claims were strings in a generated file. The settings page
rendered 81 working-looking switches over code that did not exist, and `builtin_mods` was never read
outside the settings page at all.

It also mislabelled 146 plugins as unsupported because the generator classified them by scanning
Vencord's source for `dom`, `styles` and `store` usage. Those are Vencord's techniques, not limits
here: six plugins this client implements natively - the character counter, call timer, platform
indicators, mark-server-read, connections and voice participants - are all stylesheet-based in
Vencord, and only 8 of the 166 touch a DOM at all.

So the harness exists to make two specific failure modes impossible rather than merely unlikely:

- a plugin cannot be claimed as implemented without a switch or a code path behind it
- a plugin cannot be called impossible without a reason, and the impossible set stays small

## Commands

```sh
node tools/mod-port/run.mjs status      # one-line catalog summary
node tools/mod-port/run.mjs verify      # the gate; exits non-zero on any failure
node tools/mod-port/run.mjs propose 20  # ranked backlog as markdown
node tools/mod-port/run.mjs propose 20 --json
node tools/mod-port/selftest.mjs        # tests for the harness itself
```

## How porting works

1. `propose` ranks the `Planned` backlog by how much this client already has to work with. A mod that
   reuses an existing preference is a few lines in a render function; one that needs new saved state
   touches the store, the UI struct, the settings page, the per-frame sync and a serde default.
2. The agent reads the proposal, then reads the actual code the evidence points at. The proposal
   ranks and informs; it never decides. A lexical match cannot tell whether code implements a
   behaviour or merely mentions it.
3. The port lands with tests, and the catalog entry moves from `Planned` to `NativeOptIn` (with a
   `Setting` variant) or `Native`.
4. `verify` runs in CI and fails the build if any of that was skipped.

## What `verify` checks

| Check | Catches |
| --- | --- |
| unique ids, non-empty name/description/note | a placeholder that reads as a claim |
| all 166 entries present | a curated subset presented as complete |
| `Setting::X` exists in the enum | a switch naming a variant that was never declared |
| every declared `Setting` is used | a port that was reverted, leaving a promise behind |
| `NativeOptIn` has a setting | an opt-in label on something with no switch |
| `Unsupported` stays under 15 | classifying by implementation technique again |
| `Planned` entries carry no switch | a backlog item presenting as working |
| preference and UI fields exist | a switch wired to nothing |
| harness self-tests | a parser that misreads the catalog and agrees with itself |

## Adding a mod

The catalog is generated. Edit the generator, not `catalog.rs`:

- native, always on, no switch: `NATIVE`
- native behind a preference: `OPT_IN`, plus a `Setting` variant, a preference in `AppPreferences`, a
  field on `MessagingUi`, both directions in `app_settings`, and a per-frame sync if the render path
  cannot see the preference
- implemented but different: `PARTIAL`
- portable and not built: nothing to do, it is `Planned` by default
- genuinely not possible: `UNSUPPORTED`, with a specific reason

Anything that claims a switch must be readable in the diff: `verify` will reject a `Setting` variant
that no catalog entry uses, and CI will reject a `NativeOptIn` with no switch behind it.
