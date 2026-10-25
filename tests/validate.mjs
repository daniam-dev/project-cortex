import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = 'skills/project-cortex';
const entry = fs.readFileSync(root + '/SKILL.md', 'utf8');
assert.match(entry, /^---\nname: project-cortex\ndescription: [^\n]+\n---\n/);
assert.ok(entry.length < 6000);
assert.ok(!/TODO|\[INSERT|\[TODO/.test(entry));
for (const match of entry.matchAll(/\]\(([^)]+)\)/g)) assert.ok(fs.existsSync(path.join(root, match[1])), match[1]);
function visit(dir) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) visit(p);
    else {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(p));
      assert.ok(!text.startsWith('\uFEFF') && !text.includes('\r') && text.endsWith('\n'), p);
    }
  }
}
visit(root);
assert.ok(!fs.existsSync('.codex/memory'), 'El repositorio fuente no debe inicializarse');
console.log('Paquete válido: frontmatter, nombre, referencias, tamaño, UTF-8/LF y separación de pruebas.');
