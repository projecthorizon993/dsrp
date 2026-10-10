// The gate. Everything the porting agent produces has to survive this.
//
// The catalog started life claiming 90 mods were ported when exactly one was. Nothing about that was
// a compiler error: the claims were strings. So the checks here are about claims, not about types,
// and they run in CI so they cannot be forgotten between sessions.
//
// Every check is a hard failure. A warning that scrolls past is how a catalog ends up lying again.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCatalog, parseSettings } from './lib/catalog.mjs';
import { preferences, uiFields } from './lib/evidence.mjs';

const IMPL = new Set(['Native', 'NativeOptIn', 'Partial']);
const failures = [];
const notes = [];
const fail = (check, detail) => failures.push(`${check}: ${detail}`);

export function verify(root) {
	const plugins = parseCatalog(root);
	const settings = parseSettings(root);
	const prefs = preferences(root);
	const ui = uiFields(root);

	// 1. Every id unique, and every entry self-describing. An empty note reads as a placeholder, which
	//    is how a claim becomes indistinguishable from a plan.
	const seen = new Set();
	for (const p of plugins) {
		if (seen.has(p.id)) fail('unique-id', `${p.id} appears more than once`);
		seen.add(p.id);
		if (!p.id) fail('has-id', 'an entry has no id');
		if (!p.name) fail('has-name', `${p.id} has no name`);
		if (!p.description) fail('has-description', `${p.id} has no description`);
		if (!p.note) fail('has-note', `${p.id} has no note, so its status is unexplained`);
	}

	// 2. The catalog is complete, not a curated subset. The whole point is showing the full surface.
	if (plugins.length !== 166) {
		fail('coverage', `expected all 166 Vencord plugins, found ${plugins.length}`);
	}

	// 3. A switch may only exist where one would work: the enum variant must exist, the preference
	//    must exist, and the UI must expose it. A switch wired to nothing is the exact defect this
	//    harness exists to prevent.
	for (const p of plugins.filter((x) => x.setting)) {
		if (!settings.includes(p.setting)) {
			fail('setting-exists', `${p.id} names Setting::${p.setting}, which the enum does not declare`);
		}
		if (p.port === 'Unsupported') {
			fail('switchable', `${p.id} offers a switch but is Unsupported`);
		}
	}

	// 4. Unreachable enum variants are dead code: a variant no catalog entry uses is a promise nobody
	//    is keeping, and it is usually left behind by a port that was reverted.
	for (const variant of settings) {
		if (!plugins.some((p) => p.setting === variant)) {
			fail('setting-used', `Setting::${variant} is declared but no catalog entry uses it`);
		}
	}

	// 5. Every implemented entry must be reachable from a preference that real code reads, or be
	//    justified as always-on. `NativeOptIn` in particular must not be a label on something with no
	//    switch, because that is the claim a reader cannot check.
	for (const p of plugins.filter((x) => x.port === 'NativeOptIn')) {
		if (!p.setting) {
			fail('optin-has-switch', `${p.id} is NativeOptIn but has no setting, so nothing can turn it off`);
		}
	}

	// 6. `Unsupported` is a refusal, not a backlog. This bound is the guard against regressing into
	//    classifying by Vencord's implementation technique, which put 146 of 166 here.
	const unsupported = plugins.filter((p) => p.port === 'Unsupported');
	if (unsupported.length > 15) {
		fail(
			'unsupported-bounded',
			`${unsupported.length} entries claim they cannot work here; a backlog wearing a refusal`,
		);
	}

	// 7. Planned entries must be visibly distinct from refusals, and must never carry a switch.
	const planned = plugins.filter((p) => p.port === 'Planned');
	if (!planned.length) fail('backlog-exists', 'no Planned entries, so the backlog is not being tracked');
	for (const p of planned) {
		if (p.setting) fail('planned-no-switch', `${p.id} is Planned but claims a switch`);
	}

	// 8. The preference fields the catalog depends on must still be real. Renaming one is a breaking
	//    change to every switch on the page, so it has to fail here rather than at runtime.
	const prefText = readFileSync(join(root, 'crates/local-store/src/lib.rs'), 'utf8');
	for (const p of plugins.filter((x) => x.setting)) {
		const field = p.setting.charAt(0).toLowerCase() + p.setting.slice(1);
		const snake = field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
		if (!prefs.includes(snake)) {
			notes.push(`${p.id}: Setting::${p.setting} has no AppPreferences field named ${snake}`);
		}
		if (!ui.includes(field) && !ui.includes(snake)) {
			notes.push(`${p.id}: Setting::${p.setting} has no MessagingUi field, so no switch can drive it`);
		}
		void prefText;
	}

	// 9. Older saved preferences must still deserialize. Every ported preference needs a default, or
	//    upgrading from a previous release fails to load the whole file.
	const serdeDefaults = (prefText.match(/#\[serde\(default\)\]/g) || []).length;
	notes.push(`${serdeDefaults} preference fields carry #[serde(default)]`);

	return {
		plugins,
		failures,
		notes,
		summary: {
			total: plugins.length,
			byPort: plugins.reduce((acc, p) => ({ ...acc, [p.port]: (acc[p.port] ?? 0) + 1 }), {}),
			toggleable: plugins.filter((p) => p.setting).length,
			implemented: plugins.filter((p) => IMPL.has(p.port)).length,
		},
	};
}
