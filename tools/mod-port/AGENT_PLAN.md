# Agent plan: porting Vencord mods into Serein

A brief for an agent that ports mods. It exists because the first attempt at this produced a catalog
claiming 90 of 166 mods were ported when exactly one was, rendered as 81 working switches over code
that did not exist, and mislabelled 146 plugins as impossible for the wrong reason. All three were
invisible to the compiler, because all three were strings in a generated file.

**Read this section before touching anything.** The failure mode is not writing bad Rust. It is
writing plausible, well-documented, unverified *claims*.

## Objective

Move plugins from `Planned` to genuinely working, each with tests, each honestly labelled.

Port the **behaviour**, not the plugin. Vencord patches a minified web app; this client renders
natively with no DOM and no CSS injection. A stylesheet in Vencord's source says nothing about
feasibility here - six plugins already implemented natively in this client (characterCounter,
callTimer, platformIndicators, readAllNotificationsButton, showConnections, userVoiceShow) are all
stylesheet-based upstream. Only 8 of the 166 touch a DOM at all.

## Non-goals

- Do not restyle, re-theme, or rename existing UI beyond what the mod requires.
- Do not refactor `crates/ui/src/timeline.rs` incidentally. It is the hottest path in the app and
  changes there cannot be verified by eye from CI.
- Do not delete or weaken a failing test to make a port pass.
- Do not add a switch that does not drive real behaviour.

## The one invariant

**Never let the catalog claim something the code does not do.**

Enforced by `node tools/mod-port/run.mjs verify`, which is the only command CI fails on. It checks
that a `Setting::X` exists in the enum, that every declared variant is used, that `NativeOptIn` has a
switch, that `Planned` claims no switch, that all 166 entries are present, and that `Unsupported`
stays under 15.

The gate cannot check that a GUI behaves correctly. Only a test that fails when the flag is ignored
can. That is the part you own.

## Per-mod workflow

### 1. Choose

```sh
node tools/mod-port/run.mjs propose 20
```

Ranked by how much this client already has to work with. Prefer high rank: a mod reusing an existing
preference is a few lines in a render function; one needing new saved state touches six files.

Treat the proposal as a starting point, not an instruction. It ranks and informs. A lexical match
cannot tell whether code implements a behaviour or merely mentions it.

### 2. Read before writing

Open the files the evidence points at. Establish:
- what the user actually sees change
- which render or send site owns it
- whether the data it needs is already in state

If the data is not reachable, stop and say so. Do not invent a plumbing shortcut.

### 3. Classify

| Reality | Port | In the generator |
| --- | --- | --- |
| Works, always on, nothing to switch | `Native` | `NATIVE` |
| Works behind a real preference | `NativeOptIn` | `OPT_IN` + `Setting` variant |
| Works, but differs from upstream | `Partial` | `PARTIAL` |
| Portable, not built yet | `Planned` | nothing, it is the default |
| No client behaviour left to reproduce | `Unsupported` | `UNSUPPORTED` + specific reason |

The catalog is **generated**. Edit `gen-catalog.js`, never `catalog.rs`.

`Unsupported` is for a handful whose entire deliverable is a web page or Vencord's own backend. If
you are adding to it, the honest answer is almost certainly `Planned`.

### 4. Scaffold

```sh
node tools/mod-port/run.mjs scaffold <id> --note "what it does here"
```

Writes the six mechanical edits: `Setting` variant, preference with default, UI field, both
directions of persistence, switch arm. Idempotent. Throws loudly if an anchor moved rather than
writing somewhere wrong.

### 5. Implement

Write the behaviour. Read the new preference at the site that owns it.

If that site is deep in the call tree - inside a render closure, or a helper called from dozens of
places - add a module-level flag and set it per frame in `sync_customization`. This is the pattern
`local_time::exact_timestamps` and `typing::animate` use, and it is preferred over threading a
parameter through every call site to reach one line of arithmetic.

### 6. Test

Cover the behaviour in **both** states, and include a case where the two differ. A test that passes
with the flag ignored is worse than no test, because it looks like coverage.

```
exact_timestamps_floor_where_the_default_rounds   47h -> "2 days" rounded, "1 day" floored
both_modes_agree_away_from_a_rounding_boundary   5h  -> identical either way
```

Watch for the bug flooring exposes: rounding almost never yields 1 for days or months, so templates
could get away with a bare plural. Flooring produces 1 routinely and renders "1 days". Every unit goes
through `plural()`.

### 7. Regenerate, verify, test

```sh
node gen-catalog.js                       # regenerate catalog.rs
node tools/mod-port/selftest.mjs          # harness correctness
node tools/mod-port/run.mjs verify        # the gate
cargo test -p ui -p extensions -p local-store
cargo clippy -p ui -p extensions -p local-store --all-targets
cargo fmt --all
```

Push and let `native-client` be the real verdict for the desktop binary.

## Definition of done

A mod is done when all of these hold:

- [ ] `cargo test` passes, including a test that fails if the flag is ignored
- [ ] `clippy --all-targets` and `cargo fmt --check` are clean
- [ ] `run.mjs verify` passes
- [ ] `run.mjs selftest.mjs` passes
- [ ] the catalog entry moved out of `Planned`, with an accurate note
- [ ] the entry's note describes **this client's behaviour**, not Vencord's
- [ ] the diff contains no unrelated refactor

## Batching

Three to five mods per dispatch. Not because of context length - because a batch that fails halfway
leaves three unverifiable claims in the tree, which is the exact state this plan exists to prevent.

After each mod: run the gate. If it fails, fix it before starting the next.

## When to stop and report instead of pushing on

- The behaviour needs data the client does not have and plumbing it would be invasive
- It requires restructuring `timeline.rs` rendering, which cannot be checked by eye from here
- It is destructive (deleting messages, sending on the user's behalf)
- Making it pass would mean weakening a test or a gate

Report what you found, what blocked it, and what the options are. A mod left in `Planned` with a
note is a good outcome. A mod in `Native` that does not work is the worst possible one.

## Things that will save you time

- **The gate catches wiring mistakes, not behaviour mistakes.** If it is green and the feature still
  does nothing, the problem is the implementation, not the plumbing.
- **`tools/*` is a Cargo workspace glob.** A non-Rust directory there breaks every cargo command
  until it is added to `exclude` in the root `Cargo.toml`.
- **Positive durations render as "in 2 days".** Relative-time tests need negative ones for "ago".
- **Third-party breakage is common here.** `wgpu-hal` did not compile on Windows at all until
  `gpu-allocator` was forced onto the same `windows` crate version; the `SEREIN-PATCH.md` next to it
  records the diagnosis.
- **Check whether it already exists before porting.** `readAllNotificationsButton`,
  `characterCounter`, `callTimer`, `whoReacted` and a dozen others are already native. The catalog is
  the fastest way to find out, and it is only accurate because the gate runs in CI.

## Where things are

| Path | What |
| --- | --- |
| `tools/mod-port/run.mjs` | `verify`, `propose`, `scaffold`, `status` |
| `tools/mod-port/verify.mjs` | the gate |
| `tools/mod-port/propose.mjs` | ranking and proposals |
| `tools/mod-port/scaffold.mjs` | the six mechanical edits |
| `tools/mod-port/README.md` | commands and what each check catches |
| `crates/extensions/src/builtin_plugins/` | catalog and `Port`/`Setting` types |
| `crates/local-store/src/lib.rs` | `AppPreferences`, where every preference lives |
| `apps/desktop/src/app_settings.rs` | observe/apply, both directions |
| `apps/desktop/src/main.rs` | `sync_customization`, where per-frame flags are set |
| `.github/workflows/mod-port-agent.yml` | the gate in CI, weekly backlog refresh |
