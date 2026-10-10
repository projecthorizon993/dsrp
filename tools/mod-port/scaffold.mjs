// Scaffolds the mechanical part of a port.
//
// Every mod so far has needed the same six edits in six files before a single line of behaviour is
// written: a `Setting` variant, a preference with a serde default, a UI field, two directions of
// persistence, and a switch arm. That is what makes each port slow, and it is exactly the part that
// must never be forgotten - `verify` fails the build if a switch has no preference behind it.
//
// So generate it. What this deliberately does *not* do is write the behaviour: that is the part that
// needs reading the code, and the part the tests have to cover. The scaffold leaves a clearly marked
// hole for it rather than a plausible-looking stub.
//
// Every edit is idempotent and anchored to a declaration, so running it twice changes nothing and a
// file that has been refactored fails loudly instead of being corrupted.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const snake = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const camel = (name) => name.charAt(0).toLowerCase() + name.slice(1);

/// Insert `addition` just before the closing brace of the block opened by `header`.
function beforeBlockEnd(source, header, addition) {
	const start = source.indexOf(header);
	if (start < 0) throw new Error(`could not find ${JSON.stringify(header)}`);
	const end = source.indexOf('\n}', start);
	if (end < 0) throw new Error(`could not find the end of ${JSON.stringify(header)}`);
	if (source.slice(start, end).includes(addition.trim())) return source;
	return `${source.slice(0, end)}\n${addition}${source.slice(end)}`;
}

/// Insert `addition` immediately after the first line containing `anchor`, if not already present.
function afterLine(source, anchor, addition, marker) {
	if (marker && source.includes(marker)) return source;
	const index = source.indexOf(anchor);
	if (index < 0) throw new Error(`could not find anchor ${JSON.stringify(anchor)}`);
	const at = index + anchor.length;
	return `${source.slice(0, at)}\n${addition}${source.slice(at)}`;
}

const edit = (path, fn) => {
	const full = join(path);
	const before = readFileSync(full, 'utf8');
	const after = fn(before);
	if (after !== before) writeFileSync(full, after, 'utf8');
	return after !== before;
};

export function scaffold(root, id, { setting, note, force = false } = {}) {
	const variant = setting ?? id.replace(/^./, (c) => c.toUpperCase());
	const pref = snake(variant);
	const field = camel(variant);
	const changed = [];

	if (
		edit(join(root, 'crates/extensions/src/builtin_plugins/mod.rs'), (s) =>
			afterLine(
				s,
				'\tExactTimestamps,',
				`\t${variant},`,
				`\n\t${variant},\n`,
			),
		)
	) {
		changed.push('crates/extensions/src/builtin_plugins/mod.rs (Setting variant)');
	}

	if (
		edit(join(root, 'crates/local-store/src/lib.rs'), (s) => {
			let out = beforeBlockEnd(
				s,
				'pub struct AppPreferences {',
				`\t/// Device-local opt-in for the \`${id}\` mod; older saved preferences deserialize with it off.\n\tpub ${pref}: bool,`,
			);
			out = afterLine(
				out,
				'\t\tconvert_emoticons: false,',
				`\t\t${pref}: false,`,
				`\n\t\t${pref}: false,`,
			);
			return out;
		})
	) {
		changed.push('crates/local-store/src/lib.rs (preference + default)');
	}

	if (
		edit(join(root, 'crates/ui/src/lib.rs'), (s) =>
			beforeBlockEnd(
				s,
				'pub struct MessagingUi {',
				`\t/// Backs the \`${id}\` mod on the Built-in Mods page.\n\tpub ${field}: bool,`,
			),
		)
	) {
		changed.push('crates/ui/src/lib.rs (UI field)');
	}

	if (
		edit(join(root, 'apps/desktop/src/app_settings.rs'), (s) => {
			let out = afterLine(
				s,
				'\t\t\texact_timestamps: ui.exact_timestamps,',
				`\t\t\t${pref}: ui.${field},`,
				`\n\t\t\t${pref}: ui.${field},`,
			);
			out = afterLine(
				out,
				'\t\tui.exact_timestamps = value.exact_timestamps;',
				`\t\tui.${field} = value.${pref};`,
				`\n\t\tui.${field} = value.${pref};`,
			);
			return out;
		})
	) {
		changed.push('apps/desktop/src/app_settings.rs (observe + apply)');
	}

	if (
		edit(join(root, 'crates/ui/src/settings.rs'), (s) =>
			afterLine(
				s,
				'\t\t\t\t\t\tSome(Setting::ExactTimestamps) => (&mut self.exact_timestamps, plugin.note),',
				`\t\t\t\t\t\tSome(Setting::${variant}) => (&mut self.${field}, plugin.note),`,
				`Some(Setting::${variant})`,
			),
		)
	) {
		changed.push('crates/ui/src/settings.rs (switch arm)');
	}

	if (note) {
		const generator = 'C:/Users/Admin/AppData/Local/Temp/opencode/gen-catalog.js';
		changed.push(`generator: add to OPT_IN -> ${id}: { note: ${JSON.stringify(note)}, setting: '${variant}' }`);
	}

	return { variant, pref, field, changed, forced: force };
}

export function instructions({ id, variant, pref, field }) {
	return `
Scaffolded \`${id}\` as Setting::${variant} / \`${pref}\` / \`${field}\`.

Still to do, by hand, because these need the code read rather than generated:

 1. Implement the behaviour and read \`self.${field}\` at the render or send site. If that site is
    deep in the call tree, add a module-level flag like local_time::set_exact_timestamps and set it
    per frame in sync_customization, rather than threading a bool through every call site.
 2. Add tests covering the behaviour in BOTH states. The catalog gate cannot check this; only a test
    that fails when the flag is ignored can.
 3. Regenerate the catalog so the entry moves from Planned to NativeOptIn.
 4. Run: node tools/mod-port/selftest.mjs && node tools/mod-port/run.mjs verify

If the behaviour turns out to be always-on rather than switchable, drop the scaffold and add the id
to NATIVE in the generator instead - an entry with no switch is the defect the gate exists to catch.
`;
}
