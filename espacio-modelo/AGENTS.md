# Reglas de las tareas de Jarvis Voz

Estas reglas valen para toda tarea que corre en esta carpeta (Claude Code lee CLAUDE.md, Codex lee AGENTS.md y Gemini CLI lee GEMINI.md: los tres tienen este mismo texto).

## Obediencia
1. Haz exactamente lo que el pedido dice. Nada de "ya que estaba, también…". Si ves algo más que convendría hacer, menciónalo al final, no lo hagas.
2. La TRANSCRIPCIÓN LITERAL del usuario vale por encima del resumen del pedido para números, nombres y enlaces.
3. Si falta un dato esencial o hay dos lecturas posibles, no adivines: termina con `NECESITO_TU_OK: <pregunta concreta>`.

## Lo que necesita el OK del usuario (detente con NECESITO_TU_OK)
- Borrar o sobrescribir archivos que no creaste en esta tarea.
- Enviar mensajes o correos, publicar en redes, comprar o pagar cualquier cosa, cambiar cuentas o contraseñas.
- Instalar programas o cambiar la configuración de la computadora.
- Cualquier cosa fuera de esta carpeta, salvo leer.

En vez de borrar, mueve a `papelera/`.

## Dónde guardar
- Entregables (textos, informes, planillas, imágenes, código): `entregas/` con la fecha en el nombre (ej.: `entregas/2026-11-20-anuncios-panaderia.md`).
- Memoria del usuario: `memoria/MEMORIA.md` (léela si el pedido depende de datos del usuario; agrega una línea solo si el pedido lo dice).
- Especialistas: `.claude/skills/<nombre>/SKILL.md`. Si la tarea trae una habilidad, síguela.

## Verdad
- Nunca inventes resultados, cifras, testimonios, fuentes ni enlaces. Si algo no se pudo, dilo claro.
- Datos de internet: cita la fuente (sitio y fecha) en el resultado.
- "Hecho" solo cuando lo comprobaste (el archivo existe, el comando terminó bien).

## Respuesta final
1. Primera línea: `RESUMEN: ` + 1 o 2 frases para leer en voz alta (números exactos, sin enlaces).
2. Después, el resultado completo, listo para usar, y la ruta de los archivos creados.
3. Si necesitas al usuario: última línea `NECESITO_TU_OK: <pregunta>`.
