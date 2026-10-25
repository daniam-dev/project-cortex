---
name: project-cortex
description: Preparar, consultar y mantener memoria persistente y selectiva de un proyecto con Project Cortex; inicializar, comprobar, reparar, consolidar o migrar su instalación local.
---

# Project Cortex

Las opciones de `$project-cortex` son convenciones de esta skill, no comandos de Codex.
Usa Node.js 22 o posterior. Ejecuta `node <esta-skill>/scripts/cortex.mjs --root <proyecto> <acción>` pasando argumentos como datos. Inspecciona primero las instrucciones y el repositorio objetivo. No inicialices el repositorio fuente de la skill para probarla.

Sin argumentos, ejecuta el script sin acción: muestra estado y acciones, sin escribir.

| Acción | Procedimiento |
| --- | --- |
| `--init` | Inspeccionar y preparar instalación local. Explicar revisión de confianza y reinicio. |
| `--status` | Estado breve, versión, pendientes y límites de observación. Solo lectura. |
| `--check` | Diagnóstico separado en errores, avisos y no comprobado. Solo lectura. |
| `--repair` | Reparación mecánica conservadora; detenerse ante conflictos manuales. |
| `--consolidate` | Leer [mantenimiento](references/maintenance.md), obtener snapshot y elaborar/aplicar plan semántico en esta sesión. No terminar tras mostrar únicamente el snapshot. |
| `--upgrade` | Migración conocida del esquema local; no descarga ni actualiza la skill. |

`--dry-run` acompaña init, repair, consolidate y upgrade. No escribas planes, temporales ni memoria en el proyecto en este modo; entrega el plan por stdin. Rechaza acciones múltiples u opciones ambiguas.

La interpretación corresponde al agente actual: sin otro modelo, servicios ni transcripción del chat. Lee [el protocolo](assets/protocol.md) al inicializar o consolidar. Conserva decisiones explícitas, motivos, evidencia y continuidad; una pregunta no es una decisión. No inventes conocimientos para completar plantillas. Distingue pruebas ejecutadas de propuestas.

Todas las actualizaciones de memoria, también durante turnos normales, pasan por snapshot y plan con control de concurrencia. No edites directamente los documentos instalados. Si hay conflicto, vuelve a leer y rehacer el plan. No sobrescribas personalizaciones gestionadas.

Informa qué cambió, comprobaciones realizadas y pasos manuales. Los hooks preparados no implican confianza ni activación comprobada. Si el sandbox protege `.codex`, informa el bloqueo de permisos; no cambies permisos ni uses una ruta alternativa para eludirlo.
