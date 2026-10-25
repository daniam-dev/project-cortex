import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Cortex } from '../skills/project-cortex/scripts/cortex.mjs';

const script = fileURLToPath(new URL('../skills/project-cortex/scripts/cortex.mjs', import.meta.url));
const M = '.codex/memory/';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-test-'));
  const git = spawnSync('git', ['init', '--quiet', root], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function put(root, p, text) { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), text); }
function read(root, p) { return fs.readFileSync(path.join(root, p), 'utf8'); }
function install(root) { const c = new Cortex(root); const p = c.setup('--init'); return c.commit(p.writes, false, null, p.directories); }
function tree(root) {
  const out = {};
  function visit(dir) { for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n), s = fs.lstatSync(p); out[path.relative(root, p)] = s.isDirectory() ? 'dir' : s.isSymbolicLink() ? fs.readlinkSync(p) : fs.readFileSync(p).toString('base64'); if (s.isDirectory()) visit(p); } }
  visit(root); return out;
}
function run(root, args, input) { return spawnSync(process.execPath, [script, '--root', root, ...args], { encoding: 'utf8', input: input === undefined ? undefined : JSON.stringify(input) }); }
function apply(root, writes, close) { const c = new Cortex(root), p = { base: c.snapshot(), writes, ...(close ? { close } : {}) }; return c.commit(c.plan(p), false, p.base); }
function event(root, name, extra = {}) { return new Cortex(root).event({ hook_event_name: name, session_id: 's1', turn_id: 't1', ...extra }); }

test('empty repository, integration, idempotency and relocated local runtime', t => {
  const root = fixture(t);
  put(root, 'AGENTS.md', '# Instrucciones ajenas\n\nNo publicar.\n');
  put(root, '.codex/config.toml', 'model = "existing"\n');
  const foreign = { hooks: [{ type: 'command', command: 'echo existing' }] };
  put(root, '.codex/hooks.json', JSON.stringify({ description: 'Ajeno', hooks: { Stop: [foreign] } }));
  put(root, '.gitignore', 'dist/\n');
  install(root);
  assert.ok(read(root, 'AGENTS.md').startsWith('# Instrucciones ajenas\n\nNo publicar.\n'));
  assert.equal(read(root, '.codex/config.toml'), 'model = "existing"\n');
  assert.deepEqual(JSON.parse(read(root, '.codex/hooks.json')).hooks.Stop[0], foreign);
  const before = tree(root);
  assert.deepEqual(install(root), []);
  assert.deepEqual(tree(root), before);
  assert.deepEqual(new Cortex(root).check().errors, []);
  const copy = fixture(t); fs.cpSync(root, copy, { recursive: true });
  const local = spawnSync(process.execPath, [path.join(copy, '.codex/cortex/cortex.mjs'), '--root', copy, '--check'], { encoding: 'utf8' });
  assert.equal(local.status, 0, local.stderr + local.stdout);
});

test('read-only actions, all dry runs, ambiguous arguments and empty init preview', t => {
  const root = fixture(t), before = tree(root);
  for (const args of [[], ['--status'], ['--init', '--dry-run']]) {
    const r = run(root, args); assert.equal(r.status, 0, r.stderr); assert.deepEqual(tree(root), before);
  }
  assert.equal(run(root, ['--check']).status, 1); assert.deepEqual(tree(root), before);
  install(root); const installed = tree(root);
  for (const args of [[], ['--status'], ['--check'], ['--init', '--dry-run'], ['--repair', '--dry-run'], ['--consolidate', '--dry-run'], ['--upgrade', '--dry-run']]) {
    const r = run(root, args); assert.equal(r.status, 0, r.stderr); assert.deepEqual(tree(root), installed);
  }
  for (const args of [['--init', '--repair'], ['--check', '--dry-run'], ['--plan', '-'], ['--unknown']]) assert.equal(run(root, args).status, 1);
  assert.deepEqual(tree(root), installed);
});

test('mechanical repair restores missing files and one missing marker without inventing content', t => {
  const root = fixture(t); install(root);
  fs.unlinkSync(path.join(root, M + 'LEARNINGS.md'));
  put(root, M + 'CURRENT.md', '\uFEFF# Actual\r\n\r\nEspaña: pendiente de comprobar.\r\n');
  put(root, M + 'topics/timers.md', '# Temporizadores\n');
  put(root, 'AGENTS.md', read(root, 'AGENTS.md').replace('<!-- cortex:protocol:end -->', ''));
  const before = tree(root);
  const dry = run(root, ['--repair', '--dry-run']); assert.equal(dry.status, 0, dry.stderr); assert.deepEqual(tree(root), before);
  const r = run(root, ['--repair']); assert.equal(r.status, 0, r.stderr);
  assert.equal(read(root, M + 'LEARNINGS.md'), '# LEARNINGS\n');
  assert.equal(read(root, M + 'CURRENT.md'), '# Actual\n\nEspaña: pendiente de comprobar.\n');
  assert.ok(read(root, M + 'INDEX.md').includes('topics/timers.md'));
  assert.deepEqual(new Cortex(root).check().errors, []);
});

test('manual managed changes and altered hooks are preserved with conflict', t => {
  for (const p of ['AGENTS.md', '.codex/cortex/cortex.mjs', '.codex/hooks.json']) {
    const root = fixture(t); install(root);
    if (p.endsWith('.json')) { const v = JSON.parse(read(root, p)); v.hooks.Stop[0].hooks[0].timeout = 8; put(root, p, JSON.stringify(v)); }
    else put(root, p, read(root, p).replace(p === 'AGENTS.md' ? 'Al empezar' : 'const SCHEMA', p === 'AGENTS.md' ? 'Edición manual: al empezar' : '// Edición manual\nconst SCHEMA'));
    const before = tree(root); assert.equal(run(root, ['--repair']).status, 1); assert.deepEqual(tree(root), before);
  }
});

test('semantic plan transport preserves unique details, provenance, replacements and archive links', t => {
  const root = fixture(t); install(root);
  const first = '# Decisiones\n\n## D1\nSe amplió de 30 a 60 segundos para reducir llamadas, aceptando mayor latencia. Usuario: sesión s1, turno t1. Aplicado y verificado con prueba de temporizador.\n';
  event(root, 'UserPromptSubmit', { prompt: '¿Compensa pasar a un minuto?' });
  assert.equal(read(root, M + 'DECISIONS.md'), '# DECISIONS\n'); // Event transport never interprets prompts.
  apply(root, { [M + 'DECISIONS.md']: first, [M + 'CURRENT.md']: '# Actual\n\nIntervalo 60 segundos; motivo y validación: [D1](DECISIONS.md#d1).\n' }, { session: 's1', turn: 't1', outcome: 'consolidated' });
  const out = event(root, 'SessionStart'); assert.ok(!JSON.stringify(out).includes('Se amplió'));
  assert.ok(read(root, M + 'CURRENT.md').includes('60 segundos'));
  const replacement = first + '\n## D2\nD1 sustituida por D2: 45 segundos por nueva prioridad de latencia; validación todavía pendiente. Véase [D1](#d1).\n';
  apply(root, { [M + 'DECISIONS.md']: replacement });
  apply(root, { [M + 'topics/archive/timer.md']: replacement, [M + 'DECISIONS.md']: '# Decisiones\n\nHistórico íntegro: [temporizador](topics/archive/timer.md).\n' });
  assert.equal(read(root, M + 'topics/archive/timer.md'), replacement);
  const backups = new Cortex(root).transactions();
  assert.ok(backups.some(x => Object.values(x.data.entries).some(e => e.before && Buffer.from(e.before, 'base64').toString().includes(first))));
  assert.deepEqual(new Cortex(root).check().errors, []);
});

test('no-news, duplicate delivery, interruption, stop advisory and isolated simultaneous sessions', t => {
  const root = fixture(t); install(root);
  event(root, 'UserPromptSubmit', { prompt: 'password=do-not-persist-this-secret' });
  const before = tree(root); event(root, 'UserPromptSubmit', { prompt: 'different' }); assert.deepEqual(tree(root), before);
  event(root, 'UserPromptSubmit', { session_id: 's2', turn_id: 't2' });
  event(root, 'Interrupt');
  assert.ok(event(root, 'Stop').systemMessage); assert.equal(event(root, 'Stop').decision, undefined);
  apply(root, {}, { session: 's1', turn: 't1', outcome: 'no-news' });
  event(root, 'Interrupt'); // Does not reopen a closed turn.
  const c = new Cortex(root); assert.equal(c.state().turns[c.turnKey('s1', 't1')].outcome, 'no-news');
  assert.equal(c.state().turns[c.turnKey('s2', 't2')].outcome, 'pending');
  assert.ok(!JSON.stringify(tree(root)).includes(Buffer.from('password=do-not-persist-this-secret').toString('base64')));
  assert.equal(c.walk(M + 'journal').length, 0);
  assert.deepEqual(event(root, 'Stop'), {});
});

test('stale semantic snapshot, lock contention and concurrent writers never overwrite', t => {
  const root = fixture(t); install(root);
  const c = new Cortex(root), p = { base: c.snapshot(), writes: { [M + 'CURRENT.md']: '# Stale\n' } };
  apply(root, { [M + 'CURRENT.md']: '# Newer\n' });
  assert.throws(() => c.commit(c.plan(p), false, p.base), /Conflicto/);
  assert.equal(read(root, M + 'CURRENT.md'), '# Newer\n');
  const release = new Cortex(root).acquire();
  try { assert.throws(() => apply(root, { [M + 'CURRENT.md']: '# Other\n' }), /lock/); } finally { release(); }
  const first = new Cortex(root); first.read(M + 'CURRENT.md');
  apply(root, { [M + 'CURRENT.md']: '# Most recent\n' });
  assert.throws(() => first.commit({ [M + 'CURRENT.md']: '# Lost update\n' }), /concurrente/);
  assert.equal(read(root, M + 'CURRENT.md'), '# Most recent\n');
});

test('known migration preserves custom settings and memory; future/unknown rejected without writes', t => {
  const root = fixture(t); install(root);
  put(root, M + 'PREFERENCES.md', '# Preferencias\n\nUsar español.\n');
  const manifest = JSON.parse(read(root, '.codex/cortex/manifest.json'));
  put(root, '.codex/cortex/manifest.json', JSON.stringify({ ...manifest, version: '0.9.0', schema: 0 }));
  put(root, '.codex/cortex/settings.json', '{"contextChars":9000}\n');
  const before = tree(root); assert.equal(run(root, ['--upgrade', '--dry-run']).status, 0); assert.deepEqual(tree(root), before);
  const r = run(root, ['--upgrade']); assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(read(root, '.codex/cortex/manifest.json')).schema, 1);
  assert.equal(read(root, '.codex/cortex/settings.json'), '{"contextChars":9000}\n');
  assert.equal(read(root, M + 'PREFERENCES.md'), '# Preferencias\n\nUsar español.\n');
  const upgraded = tree(root); assert.equal(run(root, ['--upgrade']).status, 0); assert.deepEqual(tree(root), upgraded);
  for (const version of ['9.0.0', '0.8.1']) {
    put(root, '.codex/cortex/manifest.json', JSON.stringify({ ...manifest, version })); const a = tree(root);
    for (const action of ['--init', '--repair', '--upgrade', '--consolidate']) assert.equal(run(root, [action]).status, 1);
    assert.deepEqual(tree(root), a);
  }
});

test('path traversal, junctions, hardlinks, secrets, broken references and invalid encoding', t => {
  const root = fixture(t), outside = fixture(t); install(root);
  for (const bad of ['../escape.md', M + '../escape.md', M + 'x:stream.md', M + 'a\\b.md', M + 'x /a.md']) {
    assert.throws(() => apply(root, { [bad]: '# no\n' }), /Ruta|fuera/);
  }
  for (const text of ['api_key=1234567890abcdef', '-----BEGIN PRIVATE KEY-----', 'ghp_123456789012345678901234']) assert.throws(() => apply(root, { [M + 'LEARNINGS.md']: '# Datos\n' + text + '\n' }), /secreto/);
  assert.throws(() => apply(root, { [M + 'CURRENT.md']: '# Actual\n\n[Missing](missing.md)\n' }), /Enlace/);
  fs.rmdirSync(path.join(root, '.codex/memory/topics'));
  fs.symlinkSync(outside, path.join(root, '.codex/memory/topics'), 'junction');
  assert.throws(() => new Cortex(root).snapshot(), /Enlace/);
  fs.unlinkSync(path.join(root, '.codex/memory/topics'));
  put(outside, 'outside.md', 'outside'); fs.linkSync(path.join(outside, 'outside.md'), path.join(root, M + 'linked.md'));
  assert.throws(() => new Cortex(root).snapshot(), /Enlace/);
  fs.unlinkSync(path.join(root, M + 'linked.md'));
  put(root, M + 'LEARNINGS.md', Buffer.from([0xff, 0xfe, 0x00])); const before = tree(root);
  assert.equal(run(root, ['--repair']).status, 1); assert.deepEqual(tree(root), before);
});

test('failure after first write is diagnosed and rolled back; later edits block recovery', t => {
  const root = fixture(t); install(root);
  const a = M + 'CURRENT.md', b = M + 'LEARNINGS.md';
  const c = new Cortex(root, { failAfter: 1 });
  assert.throws(() => c.commit({ [a]: '# Partial\n', [b]: '# Partial\n' }), /Fallo parcial/);
  assert.ok(new Cortex(root).check().errors.some(x => x.includes('incompleta')));
  const before = tree(root); new Cortex(root).recover(true); assert.deepEqual(tree(root), before);
  new Cortex(root).recover(false);
  assert.equal(read(root, a), '# CURRENT\n'); assert.equal(read(root, b), '# LEARNINGS\n');
  const c2 = new Cortex(root, { failAfter: 1 }); assert.throws(() => c2.commit({ [a]: '# Partial\n', [b]: '# Partial\n' }));
  put(root, a, '# Human later\n'); const later = tree(root);
  assert.throws(() => new Cortex(root).recover(false), /conflicto/); assert.deepEqual(tree(root), later);
});

test('consolidation preview and no-op preserve every byte', t => {
  const root = fixture(t); install(root);
  const c = new Cortex(root), plan = { base: c.snapshot(), writes: { [M + 'CURRENT.md']: '# Plan propuesto\n' } };
  const before = tree(root), preview = run(root, ['--consolidate', '--plan', '-', '--dry-run'], plan);
  assert.equal(preview.status, 0, preview.stderr); assert.ok(preview.stdout.includes('Plan propuesto')); assert.deepEqual(tree(root), before);
  assert.equal(run(root, ['--consolidate', '--plan', '-'], { base: c.snapshot(), writes: {} }).status, 0); assert.deepEqual(tree(root), before);
});

test('failure during initial installation remains recoverable via CLI', t => {
  const root = fixture(t), c = new Cortex(root, { failAfter: 1 }), p = c.setup('--init');
  assert.throws(() => c.commit(p.writes), /Fallo parcial/);
  assert.equal(fs.existsSync(path.join(root, '.codex/cortex/manifest.json')), false);
  const result = run(root, ['--repair']); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(new Cortex(root).check().errors, []);
  const ignored = spawnSync('git', ['check-ignore', '.codex/cortex/local/backups/example', '.codex/memory/journal/example.md'], { cwd: root, encoding: 'utf8' });
  assert.equal(ignored.status, 0); assert.equal(ignored.stdout.trim().split(/\r?\n/).length, 2);
});

test('configured command actually runs in Windows shell from nested cwd (payload simulation)', t => {
  const root = fixture(t); install(root);
  const cwd = path.join(root, 'nested with spaces'); fs.mkdirSync(cwd);
  const command = new Cortex(root).hookDefinition('SessionStart').hooks[0].command;
  const payload = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's1', cwd });
  const r = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { cwd, input: payload, encoding: 'utf8' })
    : spawnSync('/bin/sh', ['-c', command], { cwd, input: payload, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(new Cortex(root).state().observed.SessionStart, true);
});

test('two real processes submitting the same snapshot preserve exactly one result', async t => {
  const root = fixture(t); install(root);
  const base = new Cortex(root).snapshot();
  function writer(text) {
    return new Promise(resolve => {
      const proc = spawn(process.execPath, [script, '--root', root, '--consolidate', '--plan', '-']);
      let stderr = ''; proc.stderr.on('data', b => stderr += b); proc.stdout.resume();
      proc.on('close', code => resolve({ code, stderr }));
      proc.stdin.end(JSON.stringify({ base, writes: { [M + 'CURRENT.md']: text } }));
    });
  }
  const results = await Promise.all([writer('# Writer A\n'), writer('# Writer B\n')]);
  assert.equal(results.filter(x => x.code === 0).length, 1, JSON.stringify(results));
  assert.ok(['# Writer A\n', '# Writer B\n'].includes(read(root, M + 'CURRENT.md')));
  assert.deepEqual(new Cortex(root).check().errors, []);
});

test('manual index edits conflict; budget and duplicate warnings are read only', t => {
  const root = fixture(t); install(root);
  put(root, M + 'INDEX.md', read(root, M + 'INDEX.md').replace('<!-- cortex:index:end -->', 'Manual unique content\n<!-- cortex:index:end -->'));
  const before = tree(root); assert.equal(run(root, ['--repair']).status, 1); assert.deepEqual(tree(root), before);
  const text = '# Large\n\n' + 'Contenido reutilizable y único. '.repeat(20) + '\n';
  put(root, M + 'CURRENT.md', text); put(root, M + 'LEARNINGS.md', text);
  put(root, '.codex/cortex/settings.json', '{"documentBytes":100}\n');
  const c = new Cortex(root), after = tree(root), result = c.check();
  assert.ok(result.warnings.some(x => x.includes('Duplicado exacto')));
  assert.ok(result.warnings.some(x => x.includes('Presupuesto'))); assert.deepEqual(tree(root), after);
});

test('stale local lock is recoverable; unverifiable owner is preserved', t => {
  const root = fixture(t); install(root);
  const dead = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
  assert.equal(dead.status, 0);
  put(root, '.codex/cortex/local/write.lock', JSON.stringify({ pid: dead.pid, host: os.hostname(), time: Date.now() - 60000 }));
  apply(root, { [M + 'CURRENT.md']: '# Recovered lock\n' });
  assert.equal(fs.existsSync(path.join(root, '.codex/cortex/local/write.lock')), false);
  put(root, '.codex/cortex/local/write.lock', JSON.stringify({ pid: dead.pid, host: 'another-host', time: Date.now() - 60000 }));
  const before = tree(root);
  assert.throws(() => apply(root, { [M + 'CURRENT.md']: '# Unsafe reclaim\n' }), /lock/);
  assert.deepEqual(tree(root), before);
});

test('backup retention is bounded, future status remains read-only and repair never initializes implicitly', t => {
  const root = fixture(t);
  assert.equal(run(root, ['--repair']).status, 1); assert.equal(fs.existsSync(path.join(root, '.codex')), false);
  install(root);
  put(root, '.codex/cortex/settings.json', '{"backupCount":2}\n');
  for (let i = 0; i < 4; i++) apply(root, { [M + 'CURRENT.md']: `# Change ${i}\n` });
  assert.equal(new Cortex(root).transactions().length, 2);
  assert.equal(fs.readdirSync(path.join(root, '.codex/cortex/local/backups')).length, 2);
  const manifest = JSON.parse(read(root, '.codex/cortex/manifest.json'));
  put(root, '.codex/cortex/manifest.json', JSON.stringify({ ...manifest, version: '2.0.0', schema: 2 }));
  const before = tree(root), status = run(root, ['--status']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).installed, '2.0.0'); assert.deepEqual(tree(root), before);
});
