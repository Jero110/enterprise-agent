# Diagramas

Diagramas en Eraser de lo discutido en el vault. Cada uno lleva su enlace y una explicación corta. Si una fuente cambia, el diagrama se actualiza después; este archivo describe el estado al 2026-11-04.

**Estado:** 2 de 5 creados. Los otros 3 quedaron pendientes: el plan de Eraser llegó a su límite de archivos y después al de créditos de IA, y no se crearon.

## 1. Arquitectura objetivo: hub y miembros

Enlace: https://app.eraser.io/workspace/oa05JZHBxou2sN4DsF3D?diagram=4aClGL0IV86CIFKQHkPn&layout=canvas

- El hub es un servidor T3 en modo enterprise. Tiene el store SQLite, el repo git de knowledge y los agentes del hub.
- El `/mcp` del hub expone `knowledge_search`, `knowledge_get`, `knowledge_propose`, team y runs.
- Cada miembro corre su propia IDE T3 con su suscripción. Se conecta al hub solo si quiere.
- La conexión es un peer link de T3 (decidido en el spike T0); el hub identifica al miembro por su sesión MCP.

## 2. Customer journey: de contratados a aprobaciones

Enlace: https://app.eraser.io/workspace/oa05JZHBxou2sN4DsF3D?diagram=CkfHjvS2KazSFwP_JzKg&layout=canvas

- Nos contratan y el admin recibe el harness con su código de alta.
- El admin hace Connect Enterprise con su email y el código. Luego carga el bucket en una empresa vacía.
- La ingesta propone knowledge general y por área. Los miembros trabajan leyendo global y su área.
- Publican hilos a su área, como solo lectura o full access. Las propuestas se aprueban: área por el líder, global por el admin.

## 3. Scopes de knowledge y aprobaciones

Pendiente: no creado (límite de Eraser).

## 4. Loop RSI futuro (no construido)

Pendiente: no creado (límite de Eraser).

## 5. Estado actual vs objetivo

Pendiente: no creado (límite de Eraser).
