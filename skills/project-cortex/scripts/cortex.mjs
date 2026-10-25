#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const VERSION = '1.0.0';
const SCHEMA = 1;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEM = '.codex/memory/';
const SYS = '.codex/cortex/';
const LOCAL = SYS + 'local/';
const MANIFEST = SYS + 'manifest.json';
const STATE = LOCAL + 'state.json';
const LOCK = LOCAL + 'write.lock';
const CORE = ['CURRENT', 'INDEX', 'DECISIONS', 'PREFERENCES', 'LEARNINGS', 'ROADMAP'];
const DEFAULTS = { contextChars: 12000, documentBytes: 24000, topicCount: 30, turnCount: 200, backupCount: 10 };
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'Stop', 'Interrupt'];
const json = v => JSON.stringify(v, null, 2) + '\n';
const hash = v => v === null ? null : crypto.createHash('sha256').update(v).digest('hex');
const normalize = s => s.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const decode = b => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b);
const fail = s => { throw new Error(s); };
const secret = s => /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b|\b(?:api[_-]?key|password|secret|access[_-]?token)\s*[:=]\s*["']?[^\s"']{8,}/i.test(s);

export class Cortex {
  constructor(root, options = {}) {
    this.root = fs.realpathSync(root);
    this.options = options;
    this.reads = new Map();
  }
  safe(rel) {
    if (typeof rel !== 'string' || !rel || rel.includes('\\') || rel.includes(':') || rel.includes('\0') || path.isAbsolute(rel) || rel.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p))) fail('Ruta no segura');
    let p = this.root;
    for (const component of rel.split('/')) {
      p = path.join(p, component);
      if (fs.existsSync(p) || (() => { try { fs.lstatSync(p); return true; } catch { return false; } })()) {
        const stat = fs.lstatSync(p);
        if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) fail('Enlace no permitido: ' + rel);
        const real = fs.realpathSync(p);
        if (real !== this.root && !real.startsWith(this.root + path.sep)) fail('Ruta fuera del proyecto');
      }
    }
    return p;
  }
  raw(rel) {
    const p = this.safe(rel);
    const b = fs.existsSync(p) ? fs.readFileSync(p) : null;
    if (!this.reads.has(rel)) this.reads.set(rel, hash(b));
    return b;
  }
  read(rel) { const b = this.raw(rel); return b === null ? null : decode(b); }
  object(rel, fallback = null) { const t = this.read(rel); return t === null ? fallback : JSON.parse(normalize(t)); }
  walk(rel) {
    const dir = this.safe(rel);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).sort().flatMap(n => {
      const sub = rel + '/' + n;
      const p = this.safe(sub);
      return fs.statSync(p).isDirectory() ? this.walk(sub) : [sub];
    });
  }
  snapshot() {
    return Object.fromEntries(this.walk(MEM.slice(0, -1)).filter(p => p.endsWith('.md')).map(p => [p, hash(this.raw(p))]));
  }
  manifest(required = true, allowUnknown = false) {
    const m = this.object(MANIFEST);
    if (!m && required) fail('No instalado; ejecuta --init');
    if (m && !allowUnknown && !((m.version === VERSION && m.schema === SCHEMA) || (m.version === '0.9.0' && m.schema === 0))) fail('Versión futura o desconocida; no se modifica');
    return m;
  }
  settings() {
    const s = { ...DEFAULTS, ...this.object(SYS + 'settings.json', {}) };
    for (const k of Object.keys(DEFAULTS)) if (!Number.isSafeInteger(s[k]) || s[k] < 1 || s[k] > 10000000) fail('Presupuesto inválido: ' + k);
    return s;
  }
  state() {
    const s = this.object(STATE, { turns: {}, observed: {} });
    if (!s.turns || !s.observed) fail('Estado inválido: recuperar desde backup');
    for (const v of Object.values(s.turns)) if (!['pending', 'interrupted', 'consolidated', 'no-news'].includes(v.outcome)) fail('Estado de turno desconocido');
    return s;
  }
  compatibility() {
    const r = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const version = r.stdout?.trim() || 'desconocida';
    return { node: process.versions.node, codex: version, hooks: version === 'codex-cli 0.164.0' ? 'contrato documentado; ciclo real pendiente de verificar en este equipo' : 'versión no validada; revisar documentación oficial antes de activar', trust: 'desconocida: revisar /hooks; no se consulta ni modifica la confianza' };
  }
  index(writes = {}) {
    const files = new Set([...Object.keys(this.snapshot()), ...Object.keys(writes).filter(p => p.startsWith(MEM))]);
    const links = [...files].filter(p => p !== MEM + 'INDEX.md' && !p.startsWith(MEM + 'journal/') && !p.startsWith(MEM + 'topics/archive/')).sort().map(p => { const rel = p.slice(MEM.length); return `- [${rel}](${rel.split('/').map(encodeURIComponent).join('/')})`; });
    if ([...files].some(p => p.startsWith(MEM + 'topics/archive/'))) links.push('- Histórico inactivo: `topics/archive/` (consulta selectiva).');
    return '<!-- cortex:index:start -->\n' + links.join('\n') + '\n<!-- cortex:index:end -->';
  }
  replaceBlock(text, name, content, expected, repair = false) {
    const start = `<!-- cortex:${name}:start -->`, end = `<!-- cortex:${name}:end -->`;
    const a = text.indexOf(start), b = text.indexOf(end);
    if (a < 0 && b < 0) return text + (text && !text.endsWith('\n') ? '\n' : '') + '\n' + content + '\n';
    if (a >= 0 && b >= a && text.indexOf(start, a + start.length) < 0 && text.indexOf(end, b + end.length) < 0) {
      const old = text.slice(a, b + end.length);
      if (expected && hash(old) !== expected && old !== content) fail('Bloque gestionado modificado: ' + name);
      return text.slice(0, a) + content + text.slice(b + end.length);
    }
    // Only restore a provably intact body with one missing marker. Never guess its extent.
    if (repair && expected && hash(content) === expected) {
      const noEnd = content.slice(0, -end.length);
      const noStart = content.slice(start.length);
      if (a >= 0 && b < 0 && text.slice(a, a + noEnd.length) === noEnd) return text.slice(0, a) + content + text.slice(a + noEnd.length);
      if (a < 0 && b >= 0 && text.slice(b + end.length - noStart.length, b + end.length) === noStart) return text.slice(0, b + end.length - noStart.length) + content + text.slice(b + end.length);
    }
    fail('Bloque incompleto o duplicado: ' + name + '; revisar manualmente');
  }
  hookDefinition(event) {
    // Static bootstrap: no user content enters the shell. Supports nested cwd and paths with spaces.
    const code = "const f=require('node:fs'),p=require('node:path');let d=process.cwd();while(!f.existsSync(p.join(d,'.codex/cortex/cortex.mjs'))){const n=p.dirname(d);if(n===d)throw Error('Cortex missing');d=n;}import(require('node:url').pathToFileURL(p.join(d,'.codex/cortex/cortex.mjs')).href).then(m=>m.cli(['--root',d,'hook']));";
    return { hooks: [{ type: 'command', command: `node -e "${code}"`, timeout: event === 'Interrupt' ? 3 : 10 }] };
  }
  source(name) {
    const local = path.join(HERE, name);
    const distributed = path.join(HERE, '..', name === 'protocol.md' ? 'assets' : 'references', name);
    return normalize(decode(fs.readFileSync(fs.existsSync(local) ? local : distributed)));
  }
  setup(action) {
    const m = this.manifest(false);
    if (!m && action === '--upgrade') fail('No hay versión de origen');
    if (m && action === '--upgrade' && m.version === VERSION) return { writes: {}, note: 'Ya actualizado; sin cambios' };
    if (m && m.version !== VERSION && action !== '--upgrade') fail('Ejecuta --upgrade para migrar 0.9.0');
    const writes = {};
    const runtime = normalize(decode(fs.readFileSync(fileURLToPath(import.meta.url))));
    const protocol = this.source('protocol.md');
    const maintenance = this.source('maintenance.md');
    const block = '<!-- cortex:protocol:start -->\n' + protocol.trimEnd() + '\n<!-- cortex:protocol:end -->';
    const agents = this.read('AGENTS.md') || '';
    writes['AGENTS.md'] = this.replaceBlock(agents, 'protocol', block, m?.blocks?.protocol, action === '--repair');
    const ignore = '# Project Cortex private data\n/.codex/memory/journal/\n/.codex/cortex/local/';
    const oldIgnore = this.read('.gitignore') || '';
    const missing = ignore.split('\n').filter(x => !oldIgnore.split(/\r?\n/).includes(x));
    writes['.gitignore'] = oldIgnore + (oldIgnore && !oldIgnore.endsWith('\n') ? '\n' : '') + (missing.length ? missing.join('\n') + '\n' : '');
    for (const n of CORE) if (this.read(MEM + n + '.md') === null) writes[MEM + n + '.md'] = `# ${n}\n`;
    let idx = writes[MEM + 'INDEX.md'] ?? this.read(MEM + 'INDEX.md');
    writes[MEM + 'INDEX.md'] = this.replaceBlock(idx, 'index', this.index(writes), m?.blocks?.index, action === '--repair');
    const managed = { [SYS + 'cortex.mjs']: runtime, [SYS + 'protocol.md']: protocol, [SYS + 'maintenance.md']: maintenance };
    for (const [p, content] of Object.entries(managed)) {
      const old = this.read(p);
      if (old !== null && ((m && hash(old) !== m.managed?.[p]) || (!m && old !== content))) fail('Archivo gestionado modificado: ' + p);
      writes[p] = content;
    }
    if (this.read(SYS + 'settings.json') === null) writes[SYS + 'settings.json'] = json(DEFAULTS);
    this.settings();
    const config = this.read('.codex/config.toml');
    if (config === null) writes['.codex/config.toml'] = '# Project Cortex: hooks en hooks.json; revisar confianza con /hooks.\n';
    // Existing inline Cortex commands may represent custom handlers; refuse duplication.
    if (config?.includes('cortex.mjs')) fail('Posible handler Cortex en config.toml; integrar manualmente antes de continuar');
    const hooks = this.object('.codex/hooks.json', { hooks: {} });
    if (!hooks.hooks || Array.isArray(hooks.hooks) || typeof hooks.hooks !== 'object') fail('hooks.json inválido');
    for (const event of EVENTS) {
      const def = this.hookDefinition(event);
      const groups = hooks.hooks[event] ?? [];
      if (!Array.isArray(groups)) fail('Lista de hooks inválida');
      const owned = groups.filter(g => JSON.stringify(g).includes('cortex.mjs'));
      if (owned.length > 1 || (owned.length === 1 && JSON.stringify(owned[0]) !== JSON.stringify(def))) fail('Hook Cortex modificado o duplicado: ' + event);
      if (!owned.length) groups.push(def);
      hooks.hooks[event] = groups;
    }
    writes['.codex/hooks.json'] = json(hooks);
    writes[MANIFEST] = json({ version: VERSION, schema: SCHEMA, managed: Object.fromEntries(Object.entries(managed).map(([p, t]) => [p, hash(t)])), blocks: { protocol: hash(block), index: hash(this.index(writes)) } });
    if (action === '--repair') {
      for (const p of Object.keys(this.snapshot())) { const t = this.read(p), normalized = normalize(t).replace(/\n?$/, '\n'); if (normalized !== t) writes[p] = normalized; }
      // Recompute index after encoding repair; never discard its original outside text.
      writes[MEM + 'INDEX.md'] = normalize(writes[MEM + 'INDEX.md']);
    }
    return { writes, directories: [MEM + 'journal', MEM + 'topics'], note: 'Hooks preparados; revisar proyecto y /hooks y reiniciar. Confianza no modificada.' };
  }
  atomic(rel, data) {
    const dest = this.safe(rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = this.safe(LOCAL + 'tmp/' + crypto.randomUUID());
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    try { fs.writeFileSync(tmp, data, { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, dest); }
    finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  }
  acquire() {
    const p = this.safe(LOCK);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // Keep recovery data private even if initial setup fails before root .gitignore.
    const ignore = this.safe(LOCAL + '.gitignore');
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n', { flag: 'wx', mode: 0o600 });
    try { fs.writeFileSync(p, json({ pid: process.pid, host: os.hostname(), time: Date.now() }), { flag: 'wx', mode: 0o600 }); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const guard = this.safe(LOCAL + 'reclaim.lock');
      try { fs.mkdirSync(guard); } catch { fail('Conflicto: recuperación de lock en curso; inspeccionar si persiste'); }
      try {
        let stale = false;
        try { const v = JSON.parse(fs.readFileSync(p, 'utf8')); if (v.host === os.hostname() && Number.isInteger(v.pid) && v.pid > 0 && Date.now() - v.time > 30000) { try { process.kill(v.pid, 0); } catch (err) { stale = err.code === 'ESRCH'; } } } catch {}
        if (!stale) fail('Conflicto: lock activo o no verificable; reintenta o inspecciona');
        fs.unlinkSync(p);
        fs.writeFileSync(p, json({ pid: process.pid, host: os.hostname(), time: Date.now() }), { flag: 'wx', mode: 0o600 });
      } finally { fs.rmdirSync(guard); }
    }
    return () => fs.unlinkSync(p);
  }
  transactions() { return this.walk(LOCAL + 'backups').filter(p => p.endsWith('/transaction.json')).map(p => ({ p, data: this.object(p) })); }
  recover(dry) {
    const pending = this.transactions().filter(x => x.data.status === 'pending');
    const changes = [];
    for (const { data } of pending) for (const [p, entry] of Object.entries(data.entries)) {
      if (!['AGENTS.md', '.gitignore', '.codex/config.toml', '.codex/hooks.json'].includes(p) && !p.startsWith(MEM) && !p.startsWith(SYS)) fail('Destino de recuperación inválido');
      if (entry.before !== null && hash(Buffer.from(entry.before, 'base64')) !== entry.beforeHash) fail('Backup corrupto; recuperación manual requerida');
      const current = hash(this.raw(p));
      if (current !== entry.beforeHash && current !== entry.afterHash) fail('Recuperación en conflicto: ' + p);
      changes.push(p);
    }
    if (dry || !pending.length) return changes;
    const release = this.acquire();
    try {
      // Revalidate all targets under the lock before restoring any.
      for (const { data } of pending) for (const [p, entry] of Object.entries(data.entries)) {
        const b = fs.existsSync(this.safe(p)) ? fs.readFileSync(this.safe(p)) : null;
        if (![entry.beforeHash, entry.afterHash].includes(hash(b))) fail('Recuperación en conflicto: ' + p);
      }
      for (const { p: txPath, data } of pending) {
        for (const [p, entry] of Object.entries(data.entries)) {
          if (entry.before === null) { if (fs.existsSync(this.safe(p))) fs.unlinkSync(this.safe(p)); }
          else this.atomic(p, Buffer.from(entry.before, 'base64'));
        }
        data.status = 'rolled-back'; this.atomic(txPath, json(data));
      }
    } finally { release(); }
    this.reads.clear();
    return changes;
  }
  commit(writes, dry = false, base = null, directories = []) {
    for (const [p, t] of Object.entries(writes)) { this.safe(p); if (typeof t !== 'string') fail('Contenido no textual'); }
    const changed = Object.fromEntries(Object.entries(writes).filter(([p, t]) => this.read(p) !== t));
    const proposal = Object.entries(changed).map(([p, t]) => ({ path: p, before: hash(this.raw(p)), after: hash(t), bytes: Buffer.byteLength(t), ...(dry ? { previous: this.read(p), proposed: t } : {}) }));
    if (base) {
      const now = this.snapshot();
      if (Object.keys(now).length !== Object.keys(base).length || Object.keys(now).some(p => now[p] !== base[p])) fail('Conflicto de snapshot; releer memoria y rehacer plan');
    }
    const missingDirs = directories.filter(p => !fs.existsSync(this.safe(p)));
    if (dry) return [...proposal, ...missingDirs.map(p => ({ path: p, operation: 'mkdir' }))];
    if (!proposal.length && !missingDirs.length) return proposal;
    const release = this.acquire();
    try {
      if (this.transactions().some(x => x.data.status === 'pending')) fail('Transacción incompleta; ejecutar --repair');
      for (const [p, expected] of this.reads) {
        const b = fs.existsSync(this.safe(p)) ? fs.readFileSync(this.safe(p)) : null;
        if (hash(b) !== expected) fail('Conflicto concurrente: ' + p);
      }
      if (base) { const now = this.snapshot(); if (Object.keys(now).length !== Object.keys(base).length || Object.keys(now).some(p => now[p] !== base[p])) fail('Conflicto concurrente de memoria'); }
      const txPath = LOCAL + 'backups/' + Date.now() + '-' + crypto.randomUUID() + '/transaction.json';
      const entries = Object.fromEntries(Object.entries(changed).map(([p, t]) => { const b = this.raw(p); return [p, { before: b?.toString('base64') ?? null, beforeHash: hash(b), afterHash: hash(t) }]; }));
      const tx = { status: 'pending', entries };
      this.atomic(txPath, json(tx));
      for (const p of missingDirs) fs.mkdirSync(this.safe(p), { recursive: true });
      let i = 0;
      for (const [p, t] of Object.entries(changed)) {
        this.atomic(p, t);
        if (this.options.failAfter === ++i) fail('Fallo parcial inyectado para prueba; ejecutar --repair');
      }
      for (const [p, t] of Object.entries(changed)) if (hash(fs.readFileSync(this.safe(p))) !== hash(t)) fail('Verificación posterior fallida');
      tx.status = 'complete'; this.atomic(txPath, json(tx));
      const completed = this.transactions().filter(x => x.data.status !== 'pending').sort((a, b) => b.p.localeCompare(a.p));
      for (const x of completed.slice(this.settings().backupCount)) { const p = this.safe(x.p); fs.unlinkSync(p); fs.rmdirSync(path.dirname(p)); }
    } finally { release(); }
    return [...proposal, ...missingDirs.map(p => ({ path: p, operation: 'mkdir' }))];
  }
  plan(plan) {
    const m = this.manifest();
    if (m.schema !== SCHEMA) fail('Migración requerida antes de consolidar');
    if (!plan || !plan.base || !plan.writes || typeof plan.base !== 'object' || Array.isArray(plan.writes)) fail('Plan requiere base y writes');
    for (const k of Object.keys(plan)) if (!['base', 'writes', 'close'].includes(k)) fail('Campo de plan desconocido: ' + k);
    const writes = { ...plan.writes };
    const paths = Object.keys(writes);
    for (const p of paths) {
      this.safe(p);
      if (!p.startsWith(MEM) || !p.endsWith('.md')) fail('Plan fuera de memoria Markdown');
      if (typeof writes[p] !== 'string' || normalize(writes[p]) !== writes[p] || !writes[p].endsWith('\n')) fail('Se requiere UTF-8/LF y salto final');
      if (secret(writes[p])) fail('Posible secreto; elimina o redacta antes de persistir');
    }
    if (paths.length) {
      const idx = writes[MEM + 'INDEX.md'] ?? this.read(MEM + 'INDEX.md');
      writes[MEM + 'INDEX.md'] = this.replaceBlock(idx, 'index', this.index(writes), m.blocks?.index);
      m.blocks.index = hash(this.index(writes));
      writes[MANIFEST] = json(m);
      // Validate all local memory links in the resulting tree before any write.
      for (const p of new Set([...Object.keys(this.snapshot()), ...paths])) this.links(p, writes[p] ?? this.read(p), writes, true);
    }
    if (plan.close) {
      const { session, turn, outcome } = plan.close;
      if (!['consolidated', 'no-news'].includes(outcome)) fail('Cierre inválido');
      if (outcome === 'no-news' && paths.length) fail('Sin novedades requiere writes vacío');
      const s = this.state(), key = this.turnKey(session, turn), prior = s.turns[key];
      if (!prior) fail('Turno desconocido; preparar con hook o begin');
      if (prior.outcome === outcome && !paths.length) return writes;
      if (['consolidated', 'no-news'].includes(prior.outcome)) fail('Turno ya cerrado; no sobrescribir');
      if (outcome === 'consolidated' && !paths.some(p => writes[p] !== this.read(p))) fail('Consolidado requiere cambios relevantes');
      s.turns[key] = { ...prior, outcome, closedAt: new Date().toISOString() };
      writes[STATE] = json(s);
    }
    return writes;
  }
  links(p, t, writes = {}, strict = false) {
    const issues = [];
    for (const match of t.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const link = match[1];
      if (/^(https?:|mailto:|#)/.test(link)) continue;
      let dest;
      try {
        const target = decodeURIComponent(link.split('#')[0]);
        if (!target) continue;
        dest = path.posix.normalize(path.posix.join(path.posix.dirname(p), target));
        if (target.startsWith('/') || target.includes('\\') || !dest.startsWith(MEM)) fail('Enlace fuera de memoria');
        if (!(dest in writes) && !fs.existsSync(this.safe(dest))) fail('Enlace roto');
      } catch { issues.push('Enlace local inválido en ' + p); }
    }
    if (strict && issues.length) fail(issues.join('; '));
    return issues;
  }
  check() {
    try { return this.inspect(); }
    catch (e) { return { errors: [e.message], warnings: [], unchecked: ['Comprobación interrumpida por formato, ruta o estado inválido; no se ha escrito nada'] }; }
  }
  inspect() {
    const errors = [], warnings = [], unchecked = ['Exactitud y exhaustividad semántica', 'Confianza efectiva, políticas superiores y ciclo real de hooks', 'Destinos web y anclas Markdown'];
    let m;
    try { m = this.manifest(); } catch (e) { errors.push(e.message); return { errors, warnings, unchecked }; }
    if (m.schema !== SCHEMA) warnings.push('Migración pendiente');
    for (const n of CORE) if (this.read(MEM + n + '.md') === null) errors.push('Falta ' + n + '.md');
    for (const p of [SYS + 'settings.json', '.codex/hooks.json', '.codex/config.toml']) if (this.read(p) === null) errors.push('Falta ' + p);
    for (const [p, h] of Object.entries(m.managed || {})) if (hash(this.raw(p)) !== h) errors.push('Archivo gestionado ausente o modificado: ' + p);
    const settings = this.settings();
    const seen = new Map();
    for (const p of Object.keys(this.snapshot())) {
      const t = this.read(p);
      if (normalize(t) !== t || !t.endsWith('\n')) errors.push('Codificación/LF: ' + p);
      if (Buffer.byteLength(t) > settings.documentBytes) warnings.push('Presupuesto de tamaño: ' + p);
      errors.push(...this.links(p, t));
      if (secret(t)) warnings.push('Posible secreto: ' + p);
      for (const para of t.split(/\n\s*\n/).filter(x => x.length > 100 && !x.includes('cortex:index:'))) {
        const h = hash(para); if (seen.has(h)) warnings.push('Duplicado exacto: ' + seen.get(h) + ' y ' + p); else seen.set(h, p);
      }
    }
    const idx = this.read(MEM + 'INDEX.md');
    if (idx && !idx.includes(this.index())) errors.push('Índice desajustado');
    for (const dir of [MEM + 'journal', MEM + 'topics']) if (!fs.existsSync(this.safe(dir))) warnings.push('Directorio pendiente de crear: ' + dir);
    const agents = this.read('AGENTS.md') || '';
    const block = agents.match(/<!-- cortex:protocol:start -->[\s\S]*?<!-- cortex:protocol:end -->/g);
    if (!block || block.length !== 1 || hash(block[0]) !== m.blocks?.protocol) errors.push('Protocolo ausente, incompleto o modificado');
    const hooks = this.object('.codex/hooks.json', {});
    for (const event of EVENTS) {
      const groups = hooks.hooks?.[event];
      if (!Array.isArray(groups) || groups.filter(g => JSON.stringify(g) === JSON.stringify(this.hookDefinition(event))).length !== 1) errors.push('Hook ausente o modificado: ' + event);
    }
    const config = this.read('.codex/config.toml') || '';
    if (/\bhooks\s*=\s*false/.test(config)) warnings.push('Posible desactivación local de hooks; revisar config.toml');
    if (/\[\[?hooks[.\]]/.test(config)) warnings.push('Hooks inline y hooks.json coexisten; Codex los combina');
    const s = this.state();
    const pending = Object.values(s.turns).filter(t => ['pending', 'interrupted'].includes(t.outcome));
    if (pending.length) warnings.push(`${pending.length} turnos sin cierre`);
    if (Object.keys(s.turns).length > settings.turnCount) warnings.push('Crecimiento del estado: archivar cierres tras revisión');
    if (Object.keys(this.snapshot()).filter(p => p.startsWith(MEM + 'topics/')).length > settings.topicCount) warnings.push('Exceso de temas: recomendar consolidación');
    if (this.transactions().some(x => x.data.status === 'pending')) errors.push('Transacción incompleta; --repair');
    if (this.raw(LOCK)) warnings.push('Lock presente; comprobar propietario antes de recuperar');
    for (const rule of ['/.codex/memory/journal/', '/.codex/cortex/local/']) if (!(this.read('.gitignore') || '').split(/\r?\n/).includes(rule)) errors.push('Falta exclusión Git: ' + rule);
    const privatePaths = [LOCAL + 'backups/probe', MEM + 'journal/probe.md'];
    const git = spawnSync('git', ['-C', this.root, 'check-ignore', '--stdin'], { input: privatePaths.join('\n') + '\n', encoding: 'utf8', timeout: 5000, windowsHide: true });
    if (git.error || git.status === 128) unchecked.push('Exclusiones efectivas de Git (Git/repositorio no disponible)');
    else if (git.status !== 0 || privatePaths.some(p => !git.stdout.split(/\r?\n/).includes(p))) warnings.push('Exclusiones Git no efectivas; revisar reglas y archivos ya seguidos');
    const tracked = spawnSync('git', ['-C', this.root, 'ls-files', '--', LOCAL, MEM + 'journal'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    if (tracked.stdout?.trim()) warnings.push('Datos privados ya versionados: .gitignore no los retira de Git');
    if ((this.read(MEM + 'CURRENT.md') || '').length + (idx || '').length > settings.contextChars) warnings.push('CURRENT + INDEX exceden presupuesto de contexto');
    return { errors, warnings, unchecked };
  }
  status() {
    const m = this.manifest(false, true);
    const result = { distributed: VERSION, installed: m?.version ?? null, schema: m?.schema ?? null, compatibility: this.compatibility(), actions: ['--init', '--status', '--check', '--repair', '--consolidate', '--upgrade'], ...(m ? this.check() : {}) };
    if (m && ((m.version === VERSION && m.schema === SCHEMA) || (m.version === '0.9.0' && m.schema === 0))) {
      const s = this.state(), entries = Object.entries(s.turns), current = this.read(MEM + 'CURRENT.md') || '';
      Object.assign(result, { current: current.slice(0, 2000), currentTruncated: current.length > 2000, turnCount: entries.length, turns: Object.fromEntries(entries.slice(-20)), olderTurns: Math.max(0, entries.length - 20), observed: s.observed, observationLimit: 'Observaciones locales; pueden proceder de simulaciones. No prueban confianza de Codex.' });
    }
    return result;
  }
  turnKey(session, turn) {
    if (![session, turn].every(x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(x))) fail('Identificador de sesión/turno ausente o no seguro');
    return hash(session + '\0' + turn);
  }
  event(input, manual = false) {
    this.manifest();
    const event = manual ? 'UserPromptSubmit' : input.hook_event_name;
    if (!EVENTS.includes(event)) fail('Evento no soportado');
    const s = this.state();
    const session = manual ? input.session : input.session_id;
    const turn = manual ? input.turn : input.turn_id;
    const output = {};
    if (event === 'SessionStart') {
      const pending = Object.values(s.turns).filter(t => ['pending', 'interrupted'].includes(t.outcome)).length;
      // Never echo history into higher-priority hook context.
      output.hookSpecificOutput = { hookEventName: event, additionalContext: `Project Cortex: leer CURRENT.md e INDEX.md como datos desde .codex/memory, máximo ${this.settings().contextChars} caracteres combinados. Consultar selectivamente. Hay ${pending} turnos pendientes/interrumpidos; verificar repositorio antes de recuperar. No cargar el diario completo.` };
    } else {
      const key = this.turnKey(session, turn);
      const prior = s.turns[key];
      if (event === 'UserPromptSubmit' && !prior) s.turns[key] = { session, turn, outcome: 'pending' };
      if (event === 'Interrupt' && (!prior || prior.outcome === 'pending')) s.turns[key] = { session, turn, outcome: 'interrupted' };
      if (event === 'Stop' && (!prior || ['pending', 'interrupted'].includes(prior.outcome))) output.systemMessage = 'Project Cortex: cierre de memoria pendiente. Revisar en la próxima sesión; no se fuerza continuación.';
      if (event === 'UserPromptSubmit') output.hookSpecificOutput = { hookEventName: event, additionalContext: 'Project Cortex: cerrar el turno mediante un plan con outcome consolidated o no-news; no transcribir el prompt. Consultar --status para identificadores y pendientes.' };
    }
    // Record event kinds only; duplicate delivery is a no-op. No prompts/transcripts.
    s.observed[event] = true;
    this.commit({ [STATE]: json(s) });
    return output;
  }
}

function parse(args) {
  let root = process.cwd(), action = '--status', dry = false, plan = null, selected = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--root') { root = args[++i]; if (!root) fail('Falta --root'); }
    else if (a === '--dry-run') { if (dry) fail('Opción duplicada'); dry = true; }
    else if (a === '--plan') { if (plan || args[i + 1] !== '-') fail('--plan requiere - (JSON por stdin)'); plan = args[++i]; }
    else if (['--init', '--status', '--check', '--repair', '--consolidate', '--upgrade', 'hook', 'begin'].includes(a)) { if (selected) fail('Acciones ambiguas: elige solo una'); action = a; selected = true; }
    else fail('Opción desconocida: ' + a);
  }
  if (dry && !['--init', '--repair', '--consolidate', '--upgrade'].includes(action)) fail('--dry-run no válido para esta acción');
  if (plan && action !== '--consolidate') fail('--plan solo acompaña --consolidate');
  return { root, action, dry, plan };
}
async function stdin() {
  let result = '';
  for await (const chunk of process.stdin) { result += chunk; if (Buffer.byteLength(result) > 4000000) fail('Entrada demasiado grande'); }
  return JSON.parse(result);
}
export async function cli(args = process.argv.slice(2)) {
  try {
    const { root, action, dry, plan } = parse(args);
    if (Number(process.versions.node.split('.')[0]) < 22) fail('Se requiere Node.js >=22');
    const c = new Cortex(root);
    let result;
    if (action === '--status') result = c.status();
    else if (action === '--check') { result = c.check(); if (result.errors.length) process.exitCode = 1; }
    else if (action === 'hook' || action === 'begin') result = c.event(await stdin(), action === 'begin');
    else if (action === '--consolidate') {
      c.manifest();
      if (!plan) result = { base: c.snapshot(), budgets: c.settings(), turns: c.state().turns, next: 'El agente revisa contenido y aplica --consolidate --plan -; snapshot no equivale a consolidación terminada' };
      else { const p = await stdin(); result = { changes: c.commit(c.plan(p), dry, p.base), dryRun: dry }; }
    } else {
      let recovered = [];
      if (action === '--repair') { const installed = c.manifest(false); recovered = c.recover(dry); if (!installed && !recovered.length) fail('No instalado; usa --init'); }
      if (dry && recovered.length) result = { recovery: recovered, note: 'Se propone rollback; reejecutar repair después para planear reparaciones sobre el estado recuperado' };
      else { const p = c.setup(action); result = { changes: c.commit(p.writes, dry, null, p.directories), note: p.note, recovered, compatibility: c.compatibility(), dryRun: dry }; }
    }
    process.stdout.write(json(result));
  } catch (e) {
    process.stderr.write('Project Cortex: ' + e.message + '\n'); process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await cli();
