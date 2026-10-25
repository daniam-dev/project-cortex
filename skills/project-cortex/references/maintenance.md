# Planes, recuperación y migración

El runtime distribuido y la copia local tienen el mismo CLI. `--root` debe apuntar a la raíz del proyecto. `--consolidate` sin plan es solo lectura: entrega snapshot (hashes SHA-256 de todos los documentos de memoria), pendientes y presupuestos. Lee selectivamente los documentos afectados. El agente hace la revisión semántica en la sesión actual y completa la acción enviando un plan por stdin:

```json
{
  "base": {".codex/memory/CURRENT.md": "hash del snapshot, incluir TODOS sus archivos"},
  "writes": {".codex/memory/CURRENT.md": "# Trabajo actual\n\nContenido revisado.\n"},
  "close": {"session": "id real", "turn": "id real", "outcome": "consolidated"}
}
```

`close` es opcional en mantenimiento global. Para `no-news`, writes debe estar vacío. El plan solo admite Markdown bajo memory. Se rechazan secretos detectables, rutas peligrosas y snapshots obsoletos. No se admiten borrados: para archivar, copia íntegra a `topics/archive/`, sustituye el original por un enlace breve y conserva las referencias. Verifica información única, motivos, atribución y enlaces antes de aplicar. Las copias recuperables no sustituyen la conservación semántica.

Ejecuta `--consolidate --plan - --dry-run` para revisar archivos, hashes y diff textual propuesto; después aplica el mismo plan sin dry-run. En una invocación dry-run del usuario no lo apliques. Ninguno de esos pasos exige guardar el plan en disco. No utilices interpolación shell para JSON o mensajes: stdin desde un proceso con argumentos estructurados, o herramienta equivalente.

La transacción guarda originales en `.codex/cortex/local/backups/`, excluidos de Git. Mantiene las últimas 10 transacciones completas por defecto; nunca elimina una incompleta. Un fallo deja transacción `pending`. `--check` lo detecta; `--repair` revierte únicamente archivos que todavía coincidan con el resultado de esa transacción, o reconoce originales ya restaurados. Si alguien los editó después, se detiene sin sobrescribir. Revisa el backup y resuelve manualmente. Reintenta después. Un lock de otro proceso se rechaza; solo se recupera automáticamente si es local, tiene más de 30 segundos y el PID ya no existe. Un lock ilegible o de otra máquina requiere inspección manual; no borres un lock activo.

Presupuestos en `.codex/cortex/settings.json`: caracteres de contexto, bytes por documento, número de temas, número de turnos y retención. Son medidas de caracteres/bytes, no tokens. No se elimina historial por alcanzar un umbral. Archivos operativos y journal son privados por defecto; la memoria consolidada puede compartirse tras revisión.

Migración soportada: fixture 0.9.0 / schema 0 (misma estructura y formatos, sin budgets obligatorios) a 1.0.0 / schema 1. No se aceptan otras versiones. Se conserva settings y memoria. Un upgrade ya actual es no-op; repair es una acción separada. Runtime y bloques gestionados llevan hashes; cambios manuales requieren resolución antes de sustituirlos.
