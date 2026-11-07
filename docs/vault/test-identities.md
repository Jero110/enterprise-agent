# Identidades de prueba

Auth de desarrollo: escribes un email y el token de empresa. Si el email está autorizado, entras a tu equipo asignado. Si no, se rechaza. No hay Google real ni se envía correo. Los emails `ent.test.*` son ficticios y no se usan para nada fuera de este seed.

Token de empresa (solo dev): `ACME-BANK-DEV-2026`

Organigrama sobre Bank of Anthos: los equipos se mapean a sus servicios, más un área sin código (Riesgo) para probar que la empresa no es solo código.

| #   | Email                     | Nombre | Equipo   | Rol    |
| --- | ------------------------- | ------ | -------- | ------ |
| 1   | jeronimo.deli@gmail.com   | Jero   | Platform | admin  |
| 2   | ent.test.ana@gmail.com    | Ana    | Ledger   | lead   |
| 3   | ent.test.bruno@gmail.com  | Bruno  | Ledger   | member |
| 4   | ent.test.carla@gmail.com  | Carla  | Ledger   | member |
| 5   | ent.test.diego@gmail.com  | Diego  | Ledger   | member |
| 6   | ent.test.elena@gmail.com  | Elena  | Ledger   | member |
| 7   | ent.test.fede@gmail.com   | Fede   | Ledger   | member |
| 8   | ent.test.gerry@gmail.com  | Gerry  | Frontend | lead   |
| 9   | ent.test.hugo@gmail.com   | Hugo   | Frontend | member |
| 10  | ent.test.ines@gmail.com   | Inés   | Frontend | member |
| 11  | ent.test.juan@gmail.com   | Juan   | Frontend | member |
| 12  | ent.test.karla@gmail.com  | Karla  | Frontend | member |
| 13  | ent.test.luis@gmail.com   | Luis   | Accounts | lead   |
| 14  | ent.test.mara@gmail.com   | Mara   | Accounts | member |
| 15  | ent.test.nico@gmail.com   | Nico   | Accounts | member |
| 16  | ent.test.olga@gmail.com   | Olga   | Accounts | member |
| 17  | ent.test.pablo@gmail.com  | Pablo  | Platform | lead   |
| 18  | ent.test.quique@gmail.com | Quique | Platform | member |
| 19  | ent.test.rosa@gmail.com   | Rosa   | Risk     | lead   |
| 20  | ent.test.sofi@gmail.com   | Sofi   | Risk     | member |

Tamaños: Ledger 6, Frontend 5, Accounts 4, Platform 3, Risk 2.

Para pruebas negativas (no están en el seed):

- `ent.test.intruso@gmail.com`: nunca autorizado → rechazado.
- `ent.test.ex@gmail.com`: el admin lo autoriza y luego lo revoca → pierde acceso sin reiniciar.

## Pruebas manuales (empezando por el login)

1. Hub arriba con el seed. Abrir instancias de Jero, Ana, Gerry y Rosa.
2. Login correcto: cada uno entra a su equipo y ve su nombre, equipo y rol.
3. Token equivocado → rechazado. Email no autorizado → rechazado.
4. Jero autoriza a `ex`, `ex` entra; Jero lo revoca → `ex` queda fuera en su siguiente acción.
5. Reiniciar el hub → todos siguen enrolados.
6. Ana lee `global/` y `areas/ledger/`; no puede leer `areas/frontend/` (ni por UI ni por su agente).
7. Gerry pide acceso a Ledger → Jero lo aprueba → Gerry lo lee → Jero lo revoca → deja de leerlo.
8. El agente de Bruno propone un `.md` de Ledger → solo Ana (lead) o Jero lo aprueban → aparece en el knowledge con historial.
9. Propuesta a `global/` → solo Jero aprueba. Revertir funciona.
10. Hugo publica un hilo read-only → los de Frontend lo ven en Team Agents; los de Ledger no.
11. Un turno de Carla deja un run record con los docs que leyó y lo que propuso.

## Cómo correrlo

Desde el worktree `enterprise-ide-t3` (con `vp` en el PATH):

```
node scripts/enterprise-dev.ts --members jero,ana,gerry,rosa [--desktop]
# o: vp run dev:enterprise --members jero,ana,gerry,rosa
```

- Levanta un hub (`T3CODE_DEV_INSTANCE=hub`, `T3CODE_ENTERPRISE_HUB=1`, seed `acme-bank.seed.json`) y una instancia por nombre. Cada una usa su propio home en `.t3/instances/<nombre>` y puertos distintos; nunca toca `~/.t3/userdata`.
- Imprime la tabla nombre → email → URL (la URL del hub es el servidor; la de cada miembro es su web). Nombres válidos: los de la tabla de arriba, en minúscula.
- Ctrl-C detiene exactamente los PIDs que lanzó (se imprimen al arrancar y al parar). Volver a correrlo reutiliza la base del hub en `.t3/instances/hub`.

## Cómo conectar un miembro (dev)

1. Cada instancia necesita su propio pairing (`node apps/server/src/bin.ts pair --base-dir .t3/instances/<nombre>`) y, en Settings → Labs, **Linked environments** encendido. El hub lo trae encendido (el script lo escribe en su `settings.json`).
2. Conectar: botón **Connect Enterprise** (sidebar) o Settings → Enterprise. Dirección del hub = la URL del hub que imprime el script; código de pairing = `node apps/server/src/bin.ts pair --base-dir .t3/instances/hub` (uno nuevo por conexión); email y token de la tabla.
3. Para las pruebas 8, 10 y 11 (Bruno, Hugo, Carla) basta reutilizar una instancia: Disconnect y volver a conectar con otro email.
4. Publicar un hilo: icono "Compartir con el equipo" en la cabecera del chat (o el menú de acciones del hilo → Team publication). Los iconos Organización y Contexto están al lado; solo aparecen con el hub conectado.
5. El agente de un miembro usa `knowledge_*` por su conexión; para probarlo sin gastar mucho: `node apps/server/src/bin.ts thread start --base-dir .t3/instances/<nombre> --provider claudeAgent --model claude-haiku-5-5 --wait <proyecto> "..."`. Los turnos que no dependen del proveedor van con `--provider devReplay --model showcase` (gratis).
