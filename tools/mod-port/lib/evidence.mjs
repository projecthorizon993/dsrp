// Evidence gathering against the Serein tree.
//
// The point of this module is that a port proposal must be grounded in code that actually exists.
// An earlier version of the catalog classified plugins by scanning Vencord's source for `dom`,
// `styles` and `store` usage and then described the result as a limitation of this client, which was
// wrong: six plugins already implemented natively here are stylesheet-based in Vencord. So nothing in
// this file looks at how Vencord does something. It only asks what this client already has.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SKIP = new Set(['target', 'node_modules', '.git', 'vendor', 'dist', 'build']);

// The catalog and this harness describe the plugins, they do not implement them. Left in the search
// path they match every single plugin id, so every proposal's top hit is its own entry.
const EXCLUDE = [/^crates\/extensions\/src\/builtin_plugins\//, /^tools\/mod-port\//];

const excluded = (rel) => EXCLUDE.some((re) => re.test(rel));

export function walk(root, sub = '', out = []) {
	for (const entry of readdirSync(join(root, sub))) {
		if (SKIP.has(entry)) continue;
		const rel = sub ? `${sub}/${entry}` : entry;
		if (excluded(rel)) continue;
		const full = join(root, rel);
		if (statSync(full).isDirectory()) walk(root, rel, out);
		else if (/\.(rs|toml|py|mjs)$/.test(entry)) out.push(rel);
	}
	return out;
}

/// Split a camelCase or kebab-case plugin id into the words a human would search for.
/// `showAllMessageButtons` -> `show all message buttons`.
export function words(id) {
	return id
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[._-]+/g, ' ')
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w.length > 2);
}

/// Whether a term appears in `text` as a whole segment of some identifier.
///
/// This is deliberately not a regex. Two boundary rules were tried and both were wrong: a plain
/// substring search matches "ping" inside "typing", and a regex with a case-insensitive `(?![a-z])`
/// guard matches neither "TypingIndicator" nor "showHiddenChannels", because the flag makes `[a-z]`
/// match uppercase and the lookbehind rejects any preceding letter. Tokenising and comparing
/// segments sidesteps camelCase and snake_case entirely.
///
/// Singular and plural are treated as the same word, so "attachment" finds `attachment_files`.
export function mentions(text, terms) {
	if (!terms.length) return false;
	const wanted = new Set(terms);
	for (const token of text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
		for (const part of segments(token)) {
			// Compare the segment to the term, allowing for the segment being the plural. The first
			// version pluralised the segment and looked for it in the term set, so "attachments" could
			// never match the term "attachment".
			if (wanted.has(part) || wanted.has(part.replace(/s$/, ''))) return true;
		}
	}
	return false;
}

/// Split an identifier into its words: `no_typing_animation` -> no, typing, animation.
export function segments(identifier) {
	return identifier
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean)
		.map((w) => w.toLowerCase());
}

/// Look for identifiers in the tree that look like they relate to this plugin, and report where.
///
/// Deliberately noisy on purpose. This ranks and informs proposals; it never decides feasibility,
/// because a lexical match cannot tell whether code implements a behaviour or merely mentions it.
export function search(root, terms, { limit = 12 } = {}) {
	const files = walk(root);
	const hits = new Map();
	for (const rel of files) {
		const text = readFileSync(join(root, rel), 'utf8');
		text.split('\n').forEach((line, index) => {
			if (!mentions(line, terms)) return;
			const list = hits.get(rel) ?? [];
			if (list.length >= limit) return;
			list.push({ line: index + 1, text: line.trim().slice(0, 120) });
			hits.set(rel, list);
		});
	}
	return [...hits.entries()]
		.map(([file, matches]) => ({ file, matches }))
		.sort((a, b) => b.matches.length - a.matches.length)
		.slice(0, 12);
}

/// Whether a field name contains one of the terms as a whole segment, so `no_typing_animation`
/// counts as evidence for "typing" but not for "ping".
export function fieldMatches(field, terms) {
	const parts = segments(field);
	return terms.some((term) => parts.some((part) => part === term || part.startsWith(term)));
}

/// Which `AppPreferences` fields already exist. A plugin whose behaviour is already partly covered by
/// a saved preference is a cheaper port than one that needs new state, and the agent needs to know
/// that before it starts writing.
export function preferences(root) {
	const text = readFileSync(join(root, 'crates/local-store/src/lib.rs'), 'utf8');
	const block = text.match(/pub struct AppPreferences \{([\s\S]*?)\n\}/);
	if (!block) throw new Error('could not find AppPreferences');
	return [...block[1].matchAll(/^\tpub (\w+):/gm)].map((m) => m[1]);
}

/// Settings fields exposed on the UI struct, which is where a switch has to land to be reachable.
export function uiFields(root) {
	const text = readFileSync(join(root, 'crates/ui/src/lib.rs'), 'utf8');
	const block = text.match(/pub struct MessagingUi \{([\s\S]*?)\n\}/);
	if (!block) throw new Error('could not find MessagingUi');
	return [...block[1].matchAll(/^\tpub (\w+):/gm)].map((m) => m[1]);
}

export function rel(root, path) {
	return relative(root, path).replaceAll('\\', '/');
}
