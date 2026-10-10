// Entry point for the mod-porting harness.
//
//   node tools/mod-port/run.mjs verify     the gate; exits non-zero on any failure
//   node tools/mod-port/run.mjs propose    ranked backlog, as markdown or JSON
//   node tools/mod-port/run.mjs scaffold <id> [--note "..."]   the mechanical wiring for a port
//   node tools/mod-port/run.mjs regenerate  regenerate catalog.rs from gen-catalog.mjs
//   node tools/mod-port/run.mjs status     one-line summary of the catalog
//
// `verify` is the only command CI gates on. `propose` is what the agent reads to pick its next port,
// `scaffold` writes the six edits every port needs before any behaviour exists, and `regenerate` is
// the only supported way to change the catalog.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify } from './verify.mjs';
import { propose, render } from './propose.mjs';
import { scaffold, instructions } from './scaffold.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function repoRoot() {
	try {
		return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
	} catch {
		return join(here, '..', '..');
	}
}

const [command = 'status', ...rest] = process.argv.slice(2);
const root = repoRoot();

if (command === 'verify') {
	const result = verify(root);
	console.log(
		`${result.summary.total} plugins: ` +
			Object.entries(result.summary.byPort)
				.map(([port, n]) => `${n} ${port}`)
				.join(', '),
	);
	console.log(`${result.summary.implemented} implemented, ${result.summary.toggleable} switchable`);
	for (const note of result.notes) console.log(`note: ${note}`);
	if (result.failures.length) {
		console.error(`\n${result.failures.length} verification failure(s):`);
		for (const failure of result.failures) console.error(`  - ${failure}`);
		process.exit(1);
	}
	console.log('catalog verification passed');
} else if (command === 'propose') {
	const json = rest.includes('--json');
	const result = propose(root, { limit: Number(rest.find((a) => /^\d+$/.test(a)) ?? 25) });
	console.log(json ? JSON.stringify(result, null, 2) : render(result));
} else if (command === 'scaffold') {
	const id = rest.find((a) => !a.startsWith('--'));
	if (!id) {
		console.error('usage: run.mjs scaffold <vencord-plugin-id> [--note "what it does here"]');
		process.exit(2);
	}
	const noteIndex = rest.indexOf('--note');
	const result = scaffold(root, id, {
		note: noteIndex >= 0 ? rest[noteIndex + 1] : undefined,
	});
	console.log(
		result.changed.length
			? `scaffolded ${id}:\n${result.changed.map((c) => `  + ${c}`).join('\n')}`
			: `scaffold for ${id} was already present; nothing changed`,
	);
	console.log(instructions({ id, ...result }));
} else if (command === 'regenerate') {
	// The catalog is generated, so this is the only supported way to change it. Hand-editing
	// catalog.rs is the failure mode that produced 90 false claims in the first place.
	const output = execFileSync('node', ['tools/mod-port/catalog/gen-catalog.mjs'], {
		cwd: root,
		encoding: 'utf8',
	});
	console.log(output.trim());
} else if (command === 'status') {
	const { summary } = verify(root);
	console.log(JSON.stringify(summary, null, 2));
} else {
	console.error(`unknown command: ${command}`);
	process.exit(2);
}
