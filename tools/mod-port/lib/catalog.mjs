// Reads the generated catalog back out of Rust, so the tooling and the compiler agree on one source
// of truth. The catalog is generated, so parsing it is safe: `verify` fails if this file ever drifts
// from what the generator produces, which means a hand-edit cannot survive.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIELD = (name) => new RegExp(`^\\s*${name}:\\s*(.+?),?$`, 'm');

/// Strip the Rust string literal syntax off a field value.
function literal(raw) {
	const value = raw.trim().replace(/,$/, '');
	if (value === 'None') return null;
	if (value === '""') return '';
	const quoted = value.match(/^"(.*)"$/s);
	if (!quoted) return value;
	return quoted[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

const PORTS = new Set(['Native', 'NativeOptIn', 'Partial', 'Planned', 'Unsupported']);

export function parseCatalog(root) {
	const path = join(root, 'crates/extensions/src/builtin_plugins/catalog.rs');
	const source = readFileSync(path, 'utf8');
	const plugins = [];
	for (const chunk of source.split(/\tPlugin \{/).slice(1)) {
		const field = (name) => {
			const match = chunk.match(FIELD(name));
			return match ? literal(match[1]) : undefined;
		};
		const portRaw = (chunk.match(/^\s*port:\s*Port::(\w+),?$/m) || [])[1];
		if (!portRaw || !PORTS.has(portRaw)) {
			throw new Error(`catalog entry with unreadable port: ${chunk.slice(0, 120)}`);
		}
		// The variant has to come from its own capture group. Matching the whole `Some(Setting::X)`
		// and slicing off the prefix is what a first attempt did, and it silently produced "m" for
		// every entry - which the gate then reported as four missing enum variants.
		const settingRaw = (chunk.match(/^\s*setting:\s*(?:None|Some\(Setting::(\w+)\)),?$/m) || [])[1];
		plugins.push({
			id: field('id'),
			name: field('name'),
			description: field('description'),
			port: portRaw,
			note: field('note'),
			setting: settingRaw ?? null,
		});
	}
	return plugins;
}

/// Every `Setting` variant the Rust enum declares, so a catalog entry cannot name one that does not
/// exist. Read from source rather than hardcoded so adding a variant is enough to make it usable.
export function parseSettings(root) {
	const path = join(root, 'crates/extensions/src/builtin_plugins/mod.rs');
	const source = readFileSync(path, 'utf8');
	const block = source.match(/pub enum Setting \{([\s\S]*?)\n\}/);
	if (!block) throw new Error('could not find the Setting enum');
	return [...block[1].matchAll(/^\t([A-Z]\w*),?$/gm)].map((m) => m[1]);
}
