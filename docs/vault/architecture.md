# Arquitectura

```
          ┌──────── HUB = server T3 en modo enterprise ─────────────────────┐
          │  Enterprise store (SQLite): miembros, equipos, roles,           │
          │    token de empresa, enrollments, propuestas, run records       │
          │  Knowledge: repo git de .md   global/  areas/<team>/            │
          │  Agentes del hub (threads): ingesta, mantenimiento, review      │
          │  /mcp ← knowledge_search/get/propose, team, runs                │
          └──────▲──────────────────▲───────────────────▲───────────────────┘
                 │ conexión enterprise (peer link o propia, ver T0 del plan)
          ┌──────┴────┐      ┌──────┴────┐       ┌──────┴────┐
          │ T3 Jero   │      │ T3 Ana    │       │ T3 ...    │  cada uno con su
          │ admin     │      │ Ledger    │       │           │  suscripción; trabaja
          └───────────┘      └───────────┘       └───────────┘  solo, se conecta si quiere
```

## Por qué el hub es un server T3

T3 ya trae (ver `docs/internals/remote.md`, `apps/server/src/peer/`):

- **Peer links:** un environment entra al `/mcp` de otro con un código de pairing; el acceso es read-only a full, revocable, y el trabajo lleva `linkOrigin`.
- **Delegación remota:** un agente lanza un task que corre en otro environment.
- Auth de environments, clientes MCP y servidores headless (`npx t3`).

El costo: el hub debe estar prendido. Para demo basta una instancia dev headless.

## Quién es quién

Un miembro es un **email**. El hub guarda `email → equipo, rol (admin | lead | member)`. Entrar = email autorizado + token de empresa. El hub registra qué environment pertenece a qué email (enrollment), así una llamada del agente de Ana al `/mcp` del hub se resuelve a Ana y a su scope.

## Knowledge

```
knowledge/              (repo git en el home del hub)
  global/*.md           todos los miembros
  areas/<team>/*.md     solo el equipo, o quien tenga acceso aprobado
```

- Lectura filtrada por scope **en el server**, igual para humanos y agentes.
- Los agentes buscan bajo demanda (`knowledge_search` → `knowledge_get`). Nada se inyecta al prompt por defecto.
- Nadie escribe directo: `knowledge_propose` crea una propuesta; al aprobarse se vuelve commit con autor, aprobador y evidencia.
- Separación de memorias: hechos (qué existe) y procesos/playbooks (cómo se hizo) como `.md` distintos por scope; los episodios (run records y digests) fuera del knowledge.

## Los cuatro contratos del loop

Si la base los cumple, el loop solo construye agentes y evals:

1. **Leer:** `knowledge_search` / `knowledge_get`, filtrados por scope.
2. **Escribir:** `knowledge_propose(scope, path, contenido, razón, evidencia)`; nunca escribe directo.
3. **Decidir:** aprobar / rechazar / revertir. El líder aprueba en su área, el admin en global; cada decisión es un commit.
4. **Medir:** un run record por turno: miembro, equipo, provider/modelo, tokens, tool calls, MCPs, qué docs de knowledge leyó, qué propuso, duración y resultado.

## Team Agents

Debajo de Projects, agrupado por persona. Cada hilo se publica a mi equipo como: no publicado (solo metadatos), read-only o full access. Publicar un hilo publica también sus subagentes. Full access depende del spike de peer links.

## Restricciones de T3 que aplican

- Server: servicios Effect; RPC/MCP/HTTP delgados (decodifican, llaman un método del servicio). Contratos en `packages/contracts`.
- Mutaciones del cliente con `createEnvironmentRpcCommand`; métodos protegidos en `CLIENT_GUARDED_RPC_SCOPES`.
- Nunca correr contra `~/.t3/userdata`; cada instancia dev usa su propio home.
