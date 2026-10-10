// Tests for the harness itself.
//
// The gate is only worth anything if it reads the catalog correctly. It caught a real bug during
// development - a leftover `settingRaw[2]` index that turned every setting into a single letter - and
// it did so by disagreeing with the Rust compiler. A parser that silently misreads its input would
// instead agree with itself and pass, so these pin the shapes it has to handle.
import assert from 'node:assert/strict';
import { mentions, segments, fieldMatches, words } from './lib/evidence.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('a term does not match inside a longer word', () => {
	// The bug that put onePingPerDM top of the backlog: "ping" inside "typing".
	assert.equal(mentions('typing', ['ping']), false);
	assert.equal(mentions('stripping', ['ping']), false);
	assert.equal(mentions('typing.rs', ['typing']), true);
	assert.equal(mentions('no_typing_animation', ['typing']), true);
	assert.equal(mentions('pub struct Typing', ['typing']), true);
	// A genuine plural still matches, which is the point of tolerating the trailing "s".
	assert.equal(mentions('pings', ['ping']), true);
});

test('a term matches at a camelCase boundary', () => {
	assert.equal(mentions('TypingIndicator', ['typing']), true);
	assert.equal(mentions('showHiddenChannels', ['hidden']), true);
	assert.equal(mentions('attachment_files', ['attachment']), true);
	assert.equal(mentions('attachments', ['attachment']), true);
});

test('unrelated identifiers do not match', () => {
	assert.equal(mentions('hide_window_decorations', ['typing']), false);
	assert.equal(mentions('auto_update', ['ping']), false);
});

test('segments splits identifiers the way the search expects', () => {
	assert.deepEqual(segments('no_typing_animation'), ['no', 'typing', 'animation']);
	assert.deepEqual(segments('showAllMessageButtons'), ['show', 'all', 'message', 'buttons']);
	assert.deepEqual(segments('exact_timestamps'), ['exact', 'timestamps']);
});

test('fieldMatches does not match across word boundaries', () => {
	assert.equal(fieldMatches('no_typing_animation', ['ping']), false);
	assert.equal(fieldMatches('no_typing_animation', ['typing']), true);
	assert.equal(fieldMatches('exact_timestamps', ['timestamp']), true);
});

test('words splits plugin ids into searchable terms', () => {
	assert.deepEqual(words('showAllMessageButtons'), [
		'show',
		'all',
		'message',
		'buttons',
	]);
	assert.deepEqual(words('fakeNitro'), ['fake', 'nitro']);
});

test('the catalog parser reads settings from the real file', async () => {
	const { parseCatalog } = await import('./lib/catalog.mjs');
	const plugins = parseCatalog(process.cwd());
	assert.equal(plugins.length, 166, 'the whole Vencord plugin set, not a subset');
	const withSetting = plugins.filter((p) => p.setting);
	assert.ok(withSetting.length > 0, 'at least one entry drives a switch');
	// The regression that motivated these tests: a leftover capture-group index turned every setting
	// into a single letter, which read as four missing enum variants.
	for (const plugin of withSetting) {
		assert.ok(
			/^[A-Z][A-Za-z]+$/.test(plugin.setting),
			`${plugin.id} parsed the setting as ${JSON.stringify(plugin.setting)}, which is not a variant name`,
		);
	}
	const ports = new Set(plugins.map((p) => p.port));
	for (const expected of ['Native', 'NativeOptIn', 'Partial', 'Planned', 'Unsupported']) {
		assert.ok(ports.has(expected), `no entry uses Port::${expected}`);
	}
});

let failed = 0;
for (const [name, fn] of tests) {
	try {
		await fn();
		console.log(`ok   ${name}`);
	} catch (error) {
		failed++;
		console.error(`FAIL ${name}\n     ${error.message}`);
	}
}
console.log(`\n${tests.length - failed}/${tests.length} harness tests passed`);
process.exit(failed ? 1 : 0);
