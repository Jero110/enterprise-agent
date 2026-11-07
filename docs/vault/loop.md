# Loop RSI: notas (no construir todavía)

Se construye en las ~48 h del hackathon, encima de los cuatro contratos de [architecture.md](architecture.md). Esto son ideas y riesgos, no un plan.

## Qué tiene que demostrar

- **Antes/después medido**, no features. Si no hay gráfica, no hay evidencia.
- **Transferencia entre personas y áreas:** A (Ledger) resuelve algo → digest → propuesta aprobada → B (Frontend) resuelve un task relacionado mejor **gracias a A**.
- **Sistema nuevo:** tras N corridas en un área, generar un agente especialista (skill + playbooks + MCPs que de verdad usó) que le gane al agente genérico en un task nuevo.
- **Recursivo:** el reviewer evalúa si sus propias propuestas aprobadas en el ciclo N-1 mejoraron el ciclo N, y ajusta cómo propone y cómo filtra. Sin esto es memoria, no RSI.

## Flujo

```
run (miembro) → run record → digest (agente aislado) → review por lotes →
propuestas (nuevo / mover área↔global / quitar) → líder o admin aprueba →
commit en knowledge/ → siguiente run lo usa (bajo demanda)
```

Los agentes de mantenimiento corren en el hub, por eventos (fin de task, fin de sesión, batch nuevo de ingesta, cada N runs). Cada ingesta compara contra lo existente: qué es igual, qué cambió, qué se reemplaza.

## Señal de éxito (lo más débil hoy)

Sin señal de resultado el digest es opinión. Candidatas: tests que pasan, diff aceptado/revertido, re-prompts o correcciones del usuario, tokens y tool calls hasta la respuesta, y **cuántas veces el agente buscó contexto que ya existía en memoria** (mide directo si el knowledge sirvió).

## Diseño de eval

- ~30 tasks sobre el corpus con dueño por área; una parte requiere algo que solo descubrió otra área.
- Ablación: A sin memoria (repo crudo) · B individual · C área · D área + global con promoción. Si D no le gana a B en tasks de otra área, la tesis está muerta.
- Secuencia temporal con usuarios simulados, no corridas sueltas.
- Métricas: correcto, tokens, tool calls, contexto pedido de más, **contaminación** (hechos de un área donde no debían).

## Riesgos

- Norai: el mapa solo perdió contra el repo crudo ([norai-evidence.md](norai-evidence.md)). Lo valioso es lo que no está en ningún repo: cómo se hizo algo, qué falló, quién sabe qué.
- Compactar = deduplicar y marcar reemplazado, **no resumir** (las deep cards no ayudaron).
- Watcher de fugas: primera barrera determinista (área de origen, quién lo tocó); el LLM solo sugiere.
- Aprobaciones: fatiga del admin si todo llega a global.
