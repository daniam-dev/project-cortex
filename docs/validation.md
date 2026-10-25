# Evidencia y puerta de salida 1.0

Entorno verificado: Windows, PowerShell, Node 22.14.0 y binario Codex CLI 0.164.0. Las pruebas usan únicamente repositorios temporales. No se han cambiado confianza, permisos ni configuración personal de Codex.

## Capas distintas

1. **Estructura del paquete:** `npm run validate` verifica frontmatter, nombre, referencias, tamaño del entrypoint, UTF-8/LF y ausencia de memoria inicializada en el fuente. El validador Python de skill-creator no se ejecutó porque `python` no es utilizable en este entorno; no se atribuye su resultado al validador Node.
2. **Scripts:** `npm test`, 17 pruebas agrupadas. Incluyen procesos concurrentes reales, recuperación de lock obsoleto, retención de backups y ejecución del comando configurado desde un subdirectorio mediante PowerShell, con payloads de prueba.
3. **Comportamiento del agente:** pendiente de evaluación en una sesión independiente con la skill instalada. Las decisiones de los fixtures son redactadas de antemano; no prueban que un agente real seleccione correctamente la información.
4. **Ciclo real de hooks en Codex:** pendiente. Haber leído el contrato, comprobado versión/features y ejecutado handlers con JSON simulado no demuestra descubrimiento, confianza, entrega real de eventos ni cierre semántico.

Linux/macOS y versiones distintas de Codex no se han ejecutado. El runtime utiliza APIs multiplataforma y el test del comando elige `/bin/sh` en Unix, pero eso no constituye evidencia de ejecución en esas plataformas.

## Criterios de aceptación

| # | Criterio | Evidencia actual |
| --- | --- | --- |
| 1 | Inicialización vacía | Script en Git temporal. |
| 2 | Integración con AGENTS/config/hooks | Conservación de texto ajeno y handler previo. |
| 3 | Segunda inicialización | Árbol completo idéntico; cero cambios. |
| 4 | Seis acciones/combinaciones | CLI, opciones inválidas rechazadas. Consolidación semántica real pendiente. |
| 5 | Status/check sin escrituras | Comparación de árbol antes/después. |
| 6 | Dry-run | Todas las acciones permitidas y plan por stdin; árbol idéntico. |
| 7 | Reparación conservadora | Ausencias, BOM/CRLF, índice, marcador faltante y conflictos manuales. |
| 8 | Consolidación sin pérdida | Plan preescrito, original íntegro en archivo, referencias y backup; evaluación semántica pendiente. |
| 9 | Migración anterior | Fixture sintético 0.9.0/schema 0, misma estructura, presupuestos parciales; no representa una release publicada. |
| 10 | Futuras/desconocidas | Rechazo sin cambios. |
| 11 | Pregunta no es decisión | Handler no conserva ni interpreta prompt. Evaluación del agente pendiente. |
| 12 | 30 → 60 segundos | Fixture conserva motivo, latencia aceptada, procedencia y validación declarada; no ejecuta un temporizador real. |
| 13 | Nueva sesión | Handler remite a CURRENT/INDEX; contenido disponible. Recuperación por agente pendiente. |
| 14 | Decisión sustituida | Fixture conserva D1 y motivo, con D2. Evaluación del agente pendiente. |
| 15 | Sin novedades | Cierre operativo sin diario ni entradas vacías. |
| 16 | Interrupción/recuperación | Payload simulado, estado interrumpido y recuperación. Ciclo real pendiente. |
| 17 | Evento duplicado | Identificador sesión/turno estable; árbol idéntico. |
| 18 | Concurrencia | Dos procesos con mismo snapshot: solo uno aplica; el otro rechaza. |
| 19 | Codificación | Tildes/ñ, UTF-8, BOM/CRLF reparables; bytes inválidos rechazados. |
| 20 | Secretos/rutas | Patrones conocidos, traversal, junctions, hardlinks, enlaces rotos. No detector exhaustivo. |
| 21 | Fallo parcial | Fallo inyectado tras primer archivo; rollback y conflicto con edición posterior. Incluye instalación sin manifest todavía. |

## Procedimiento reproducible para comportamiento y hooks reales

No ejecutar estas comprobaciones en el repositorio fuente ni contra datos sensibles. No usar flags que omitan la confianza de hooks. La revisión interactiva del usuario es parte de la prueba.

1. Crear un directorio temporal con `git init`. Copiar allí una pequeña aplicación de prueba con un intervalo de 30 segundos y una prueba determinista. Instalar la skill en el ámbito personal o en `.agents/skills/project-cortex` del temporal.
2. Abrir Codex en ese repositorio y ejecutar `$project-cortex --init`. Revisar los archivos generados. Antes de confiar en los hooks, comprobar que `--status` no afirma que estén activos o confiados. Guardar evidencia del aviso o del panel `/hooks`, sin copiar prompts completos al diario.
3. Revisar y confiar explícitamente en los cuatro handlers mediante `/hooks`. No editar trust stores ni usar `--dangerously-bypass-hook-trust`. Reiniciar Codex y confirmar en `/hooks` la ejecución real de SessionStart y sus fuentes. Contrastar con el estado operativo, que por sí solo no prueba origen real.
4. Preguntar «¿compensa pasar a un minuto?». Comprobar que no se registra como decisión aprobada. Un turno sin novedades debe cerrarse como `no-news`, sin diario vacío.
5. Indicar «Amplía el intervalo de 30 a 60 segundos para reducir llamadas, aceptando más latencia; aplica el cambio y verifica la prueba». Revisar código, resultado real de prueba y memoria: debe conservar motivo, procedencia y validación exacta. Si la prueba no se ejecuta, la memoria debe decirlo.
6. Cerrar y abrir nueva sesión. Preguntar cuál es el intervalo y por qué. Confirmar recuperación selectiva desde CURRENT/INDEX y DECISIONS, sin cargar todo journal.
7. Dar una decisión posterior explícita que sustituya la anterior por un requisito nuevo. Revisar que ambas razones sobrevivan y exista enlace al reemplazo. Ejecutar `--consolidate --dry-run`, comprobar árbol sin cambios, y luego `--consolidate` si procede; comparar detalles únicos antes/después.
8. Interrumpir con Ctrl+C un turno activo tras una edición reversible. Confirmar Interrupt real y estado `interrupted`. En nueva sesión, el agente debe verificar el árbol antes de reanudar; no debe marcar consolidación automáticamente para limpiar avisos.
9. Provocar un turno sin cierre operativo. Confirmar que Stop avisa, no bloquea ni provoca una continuación. Verificar también que cerrar correctamente elimina el aviso de ese turno.
10. Repetir con Codex iniciado desde un subdirectorio con espacios. Recoger versión, SO, origen de hooks, revisión de confianza y resultados reales, sin secretos. Ejecutar `--check` al final.

Para certificar 1.0 deben completarse y registrarse estas dos capas pendientes, corregirse cualquier fallo y volver a ejecutar las pruebas afectadas. El agente autor no se considera una evaluación independiente de su propio protocolo.
