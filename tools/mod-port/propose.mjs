// Ranks the porting backlog and emits proposals the agent can act on.
//
// A proposal is not an instruction to implement something. It is a starting point with evidence: what
// the mod does, whether this client already has part of it, which files would change, and whether it
// needs new saved state. The agent still has to read the code and decide, because a lexical match
// cannot tell whether a behaviour is implemented or merely mentioned.
import { parseCatalog } from './lib/catalog.mjs';
import { search, words, preferences, uiFields, fieldMatches } from './lib/evidence.mjs';

/// Split an id into the two or three words most likely to name the behaviour, dropping the ones that
/// are too generic to be evidence of anything.
/// Words too generic to be evidence of anything. Every one of these appears in a hundred unrelated
/// identifiers, so a proposal matching only these is being ranked on noise.
const STOP = new Set([
	'the', 'and', 'for', 'with', 'all', 'show', 'add', 'no', 'my', 'own', 'per', 'plain', 'icon',
	'thing', 'things', 'tweak', 'tweaks', 'indicator', 'better', 'custom', 'user', 'server',
	'message', 'messages', 'channel', 'channels', 'member', 'members', 'voice', 'text', 'button',
	'buttons', 'color', 'colour', 'size', 'first', 'last', 'new', 'old', 'one', 'two',
]);

function keywords(id) {
	return words(id).filter((w) => !STOP.has(w));
}

/// Prefer proposals that reuse existing state. A mod needing a new preference touches the store, the
/// UI struct, the settings page, the per-frame sync and a serde default; one that does not is often a
/// few lines in a render function.
function score(plugin, hits, prefs) {
	let value = hits.length;
	if (plugin.setting) value += 6;
	const wanted = keywords(plugin.id).map((w) => w.replace(/s$/, ''));
	const covered = wanted.filter((w) => prefs.some((p) => fieldMatches(p, [w]))).length;
	value += covered * 4;
	// Something already touching the same words is a sign the subsystem exists.
	if (hits.some((h) => /crates\/ui\/src/.test(h.file))) value += 3;
	if (hits.some((h) => /crates\/ui\/src\/timeline\.rs/.test(h.file))) value += 2;
	return value;
}

export function propose(root, { limit = 25 } = {}) {
	const plugins = parseCatalog(root);
	const prefs = preferences(root);
	const ui = uiFields(root);
	const backlog = plugins.filter((p) => p.port === 'Planned');

	const proposals = backlog.map((plugin) => {
		const terms = keywords(plugin.id);
		const hits = terms.length ? search(root, terms) : [];
		const wanted = terms.map((w) => w.replace(/s$/, ''));
		const existing = [
			...new Set([...prefs, ...ui].filter((field) => fieldMatches(field, wanted))),
		];
		return {
			id: plugin.id,
			name: plugin.name,
			description: plugin.description,
			note: plugin.note,
			terms,
			hits,
			existing,
			needsNewPreference: !plugin.setting && existing.length === 0,
			score: score(plugin, hits, prefs),
		};
	});

	proposals.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
	return { total: backlog.length, proposals: proposals.slice(0, limit) };
}

export function render(result) {
	const lines = [
		'# Mod porting backlog',
		'',
		`${result.total} portable mods are not built yet. Ranked by how much this client already has`,
		'to work with, because a proposal that reuses existing state is far cheaper than one that',
		'invents new saved state.',
		'',
	];
	for (const [i, p] of result.proposals.entries()) {
		lines.push(`## ${i + 1}. ${p.name} (\`${p.id}\`) - score ${p.score}`);
		lines.push('');
		lines.push(`- **Does**: ${p.description}`);
		if (p.note && p.note !== p.description) lines.push(`- **Here it would**: ${p.note}`);
		lines.push(`- **Search terms**: ${p.terms.join(', ') || '(none)'}`);
		lines.push(
			`- **New preference needed**: ${p.needsNewPreference ? 'yes' : 'no'}` +
				(p.existing.length ? ` - existing: ${p.existing.slice(0, 5).join(', ')}` : ''),
		);
		if (p.hits.length) {
			lines.push('- **Existing code**:');
			for (const hit of p.hits.slice(0, 4)) {
				const first = hit.matches[0];
				lines.push(`  - \`${hit.file}:${first.line}\` - ${first.text}`);
			}
		} else {
			lines.push('- **Existing code**: nothing matched; this is greenfield');
		}
		lines.push('');
	}
	return lines.join('\n');
}
