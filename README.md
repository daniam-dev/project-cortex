# Project Cortex

Skill para Codex CLI que mantiene memoria selectiva por proyecto. La interpretación la hace el agente de la sesión; Node.js se encarga de rutas, integración, estados, concurrencia y recuperación. No utiliza modelos adicionales, servicios, claves ni bases de datos.

**Estado: candidata a 1.0, todavía no certificada.** Las seis acciones están implementadas y los scripts probados en Windows. Quedan pendientes la evaluación del comportamiento del agente y el ciclo real de hooks con revisión de confianza en Codex. Véase [validación](docs/validation.md). No se debe presentar la simulación de eventos como integración completa.

## Instalar y usar

Requisitos: Node.js **22+** en PATH. Contrato de hooks contrastado con documentación oficial y CLI **0.164.0**; otras versiones se señalan como no validadas. Git se usa en las pruebas; el runtime también permite preparar un directorio todavía sin Git.

El paquete instalable es únicamente **`skills/project-cortex/`**. Copia esa carpeta a `~/.agents/skills/project-cortex` para uso personal, o a `<proyecto>/.agents/skills/project-cortex` para compartirla con el equipo. No copies `tests/` ni la documentación de desarrollo. No reemplaces una instalación existente sin revisarla.

Ejemplo PowerShell, ejecutado desde este repositorio:

```powershell
$target = Join-Path $HOME '.agents/skills/project-cortex'
if (Test-Path -LiteralPath $target) { throw 'La skill ya existe; revisa antes de sustituirla.' }
New-Item -ItemType Directory -Force (Split-Path $target -Parent) | Out-Null
Copy-Item -LiteralPath './skills/project-cortex' -Destination $target -Recurse
```

Abre Codex **en el proyecto que quieras dotar de memoria**, no en este repositorio fuente. Si no aparece la skill en `/skills`, reinicia Codex. Invoca:

```text
$project-cortex --init
```

Las opciones son convenciones interpretadas por la skill, no flags nativos del ejecutable Codex.

| Invocación | Efecto |
| --- | --- |
| `$project-cortex` | Estado y acciones; solo lectura. |
| `$project-cortex --init` | Inspecciona y prepara la instalación local sin inventar memoria. |
| `$project-cortex --status` | Versión, compatibilidad, trabajo activo, pendientes y avisos. |
| `$project-cortex --check` | Diagnóstico mecánico; distingue errores, avisos y no comprobado. |
| `$project-cortex --repair` | Recupera transacciones incompletas y repara fallos mecánicos seguros. |
| `$project-cortex --consolidate` | El agente revisa contenido y aplica un plan con backup y control de concurrencia. |
| `$project-cortex --upgrade` | Migra esquema 0 / fixture 0.9.0 a esquema 1 / 1.0.0. No descarga código. |

Añade `--dry-run` a init, repair, consolidate o upgrade para obtener la propuesta sin escribir archivos, temporales ni locks. Las acciones múltiples se rechazan. Status y check también son solo lectura. El mantenimiento interno puede ejecutarse directamente con `node skills/project-cortex/scripts/cortex.mjs --root <proyecto> --check`.

## Arquitectura instalada

```text
AGENTS.md                         # instrucciones ajenas + bloque gestionado
.codex/
  config.toml                     # se conserva si ya existe
  hooks.json                      # se añaden únicamente los cuatro handlers
  memory/
    CURRENT.md  INDEX.md
    DECISIONS.md  PREFERENCES.md  LEARNINGS.md  ROADMAP.md
    journal/                      # novedades selectivas por sesión, privado
    topics/                       # temas; archive/ se crea solo si se necesita
  cortex/
    cortex.mjs                    # copia autónoma del runtime
    protocol.md  maintenance.md
    manifest.json                 # esquema, versión y hashes gestionados
    settings.json                 # presupuestos y retención
    local/                        # estado, locks, temporales y backups privados
```

Las plantillas no afirman decisiones ni conocimiento del proyecto. INDEX contiene un bloque de enlaces regenerable y admite notas fuera de él. AGENTS conserva las instrucciones ajenas fuera del bloque gestionado. Los cambios manuales dentro de bloques o scripts gestionados provocan conflicto; no se sobrescriben silenciosamente. El runtime instalado no depende de la ubicación original de la skill.

## Activación de hooks

Se prepara `.codex/hooks.json` con SessionStart, UserPromptSubmit, Stop e Interrupt. No se cambia la confianza, la política de permisos, los hooks ajenos ni los valores existentes de config.toml. Si hay hooks inline ajenos, Codex combina ambas representaciones y puede advertirlo. Una configuración inline que ya mencione Cortex exige integración manual para evitar duplicados.

Después de revisar los archivos, abre el proyecto en Codex, revisa su confianza y usa **`/hooks`** para revisar y confiar en las definiciones exactas. Reinicia o abre una nueva sesión para comprobar SessionStart. Cambiar handlers puede exigir nueva revisión. Una política superior o `features.hooks = false` puede impedir la ejecución. **Preparado no significa activado**: status no deduce confianza a partir de la ausencia de errores ni de observaciones locales, que también pueden proceder de simulaciones.

En algunos sandboxes `.codex` está protegido incluso con permiso de escritura en el proyecto. Si la instalación se bloquea, revisa/aplica la operación desde tu terminal con tus permisos normales; la skill no cambia permisos ni intenta eludir el sandbox.

SessionStart emite únicamente instrucciones fijas de lectura selectiva y un contador de pendientes. No reproduce memoria histórica como contexto de mayor autoridad. UserPromptSubmit conserva solo identificadores y estado, nunca el prompt. Stop avisa de cierres pendientes y **no solicita continuaciones**. Interrupt hace una actualización breve, con timeout de tres segundos. La sesión cierra cada turno con `consolidated` o `no-news`; este último no modifica documentos ni crea diario. Un cierre es una declaración del agente, no prueba de exhaustividad semántica.

## Política de memoria, privacidad y recuperación

Conservar decisiones y motivos, validación, cambios de requisitos, preferencias, errores útiles y próximos pasos. Separar verificado, afirmado e inferido. Una pregunta no constituye decisión. El agente preserva información única, procedencia y motivos de decisiones sustituidas, con referencia a su reemplazo. No se consolida globalmente cada turno.

Los planes se transmiten por stdin y comprueban hashes de toda la memoria antes de escribir. Los escritores Cortex cooperan mediante lock exclusivo; si otra sesión cambió algo, se rechaza el plan y se vuelve a leer. Las ediciones manuales detectadas antes de escribir también se rechazan. No se garantiza coordinación con editores externos que ignoren el protocolo ni con sistemas de archivos de red con semánticas distintas. Los symlinks/junctions y hardlinks en rutas gestionadas se rechazan; no se presupone protección contra un proceso hostil que cambie el árbol durante la operación.

Las escrituras se reemplazan atómicamente por archivo. Una transacción de varios archivos puede quedar incompleta tras un fallo: conserva originales y hashes para que `--repair` pueda revertirla sin pisar ediciones posteriores. La retención por defecto es de diez transacciones completas; nunca se purgan las incompletas. No se realizan commits como backup. Recuperación y contrato del plan: [maintenance.md](skills/project-cortex/references/maintenance.md).

`.gitignore` excluye journal y `.codex/cortex/local/`, preservando reglas anteriores. Git no deja de seguir archivos previamente añadidos: revisa los archivos ya versionados y cualquier regla local que anule exclusiones. La memoria consolidada, AGENTS y la configuración son compartibles según tu política. No se cambia `.gitattributes`. Se escribe UTF-8 sin BOM y LF; al integrar archivos ajenos se conserva su texto.

No se persisten prompts completos ni salidas de herramientas por defecto. El filtro de secretos rechaza algunos patrones conocidos; **no garantiza detectarlos todos**, incluidos secretos ya presentes en archivos o backups. Revisa antes de compartir. Los presupuestos son caracteres/bytes, no mediciones de tokens. Los umbrales recomiendan mantenimiento; no borran conocimiento automáticamente.

## Desarrollo

```text
npm test
npm run validate
```

Sin instalación de dependencias. Las pruebas crean repositorios Git bajo el directorio temporal del sistema y los limpian al terminar. Este repositorio contiene código y pruebas, **no una instancia de su propia memoria**. La publicación del código no implica una release ni la certificación de 1.0.

Fuentes oficiales consultadas el 25-10-2026: [skills y descubrimiento local](https://learn.chatgpt.com/docs/build-skills), [configuración por proyecto](https://learn.chatgpt.com/docs/config-file/config-basic), [contrato y confianza de hooks](https://learn.chatgpt.com/docs/hooks). La versión instalada se comprobó con `codex --version`; `codex features list` mostró `hooks stable true`.
