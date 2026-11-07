# Visión

## El hackathon

KAVAK x OpenAI x Primero AI · RSI Hackathon. Piden:

1. Un sistema de agentes funcionando sobre un problema concreto.
2. Evidencia de qué aprendió durante sus ejecuciones.
3. Un nuevo sistema construido a partir de ese aprendizaje (Recursive Self-Improvement: el aprendizaje también mejora cómo se generan, evalúan e incorporan las siguientes mejoras).

Todavía no empieza; estamos preparando la base. Al loop le dedicaremos ~48 h. La base tiene que estar lista antes para que en esas 48 h solo se construyan el loop y los evals.

## La idea

Un **harness enterprise** sobre T3 Code (open source, ya coordina agentes de varios providers en web, desktop y móvil). El loop de aprendizaje es la pieza principal, pero **a nivel empresa, no individuo**: un coding agent que aprende de su usuario lo hace cualquiera. Lo nuestro: **lo que aprende una persona le sirve a otra persona, de otra área**.

El loop no funciona sin la base: áreas conectadas y un knowledge general.

## Experiencia del cliente

1. Nos contratan. Les llega el harness y un código (o OTP) para dar de alta al admin.
2. El admin entra a T3 → Enterprise → **Connect Enterprise**, con su email y el código de la empresa.
3. La empresa empieza vacía. Solo el admin puede cargar el "bucket": repos, sheets, docs, PDFs, transcripts de meets.
4. Un agente de ingesta (con la suscripción o el modelo que tenga activado en T3) usa herramientas tipo Tree-sitter / Norai y construye el knowledge general y por área.
5. Cada usuario tiene un área asignada. Todos leen el knowledge general; el de su área solo su área. Leer otra área se pide y lo aprueba el admin.
6. Los usuarios publican sus hilos (y sus subagentes) a su área, read-only o full access. Aparecen debajo de Projects en **Team Agents**.
7. Cada ejecución deja evidencia. Agentes de mantenimiento proponen cambios al knowledge (nuevo, mover área↔global, quitar). Área lo aprueba el líder; global, el admin.
8. Resultado: preguntas "¿cómo se hace esto?" y el agente responde "alguien ya lo hizo así".

## Tres niveles de conocimiento

- **General (empresa):** qué existe y qué hace cada área. Amplio, poco profundo.
- **Área:** profundo. Qué datos, qué scripts, qué procesos exactos.
- **Individuo:** skills y procesos personales. No lo tocamos mucho.

Además del "qué es" (knowledge) hay un "cómo se hizo" (procesos/playbooks) en área y en general. Memorias separadas para que no exploten.

## Pruebas

Repos grandes ya hechos (no gastar tiempo creando corpus); nosotros definimos el organigrama. La demo/video puede ser de coches (sponsor Kavak).
