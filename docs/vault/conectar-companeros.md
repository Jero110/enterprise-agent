# Conectar a un compañero al Enterprise

Cómo se logró que otra persona vea el contexto del equipo y las conversaciones compartidas, con su propio T3 corriendo normal en su compu y sin acceso a la máquina del hub.

## Resumen corto

1. **El hub** (quien tiene el contexto) abre su app o servidor con `T3CODE_ENTERPRISE_HUB=1` y escucha en la red (`--host 0.0.0.0`, o Tailscale con `--share`).
2. **Le pasa a la otra persona su URL**: la del hub, o el pair link que imprime `vp run dev:enterprise` (`http://<ip>:<puerto>/pair#token=…`). De ese link solo se usa la dirección.
3. **La otra persona** abre Connect Enterprise y pega esa URL en "Host URL", escribe su email y deja el token vacío.

Eso es todo. El email debe estar autorizado en el hub (Settings → Enterprise → Members). El hub también pide la URL a quien lo hospeda: no hay un caso especial.

Si no conecta, casi siempre es la red: ver "Firewall de macOS" abajo. Comprobar con `curl http://<ip>:<puerto>/.well-known/t3/environment`.

## Qué se quería

- Un hub con el contexto de la empresa (repo de conocimiento, equipos, conversaciones compartidas).
- Cada persona trabaja en su compu: sus archivos, sus agentes, sus procesos.
- Conectarse solo con la dirección del hub y su email. El token es opcional y decorativo por ahora.
- Que el hub no pueda ejecutar nada en la máquina de nadie ni nadie en la del hub.

## Modelo

```
IDE de A ──► HUB ◄── IDE de B
```

Los IDEs nunca se hablan entre sí. El hub guarda contexto y quién es quién, no código. Cada IDE pregunta al hub por la lista del equipo y por lo que otros compartieron (Share with team → Read-only, visible en Team Agents).

Conectarse a Enterprise y agregar un entorno (pair link) son cosas distintas:

|                              | Connect Enterprise                      | Pair link en Environments     |
| ---------------------------- | --------------------------------------- | ----------------------------- |
| Qué crea                     | Conexión interna de solo lectura al hub | Un entorno elegible en Run on |
| Puede correr cosas en el hub | No                                      | Según los permisos del link   |

## Qué cambió en el código

- **Token opcional.** El email autorizado es la puerta; el token solo se valida si se manda. `EnterpriseLoginInput.token` es opcional en el contrato, el hub y la herramienta MCP.
- **Sin sesión de entorno.** El inicio de sesión ya no emite ni guarda una sesión completa sobre el hub (`EnterpriseBootstrap`, `EnterpriseConnectResult`, `ConnectEnterpriseDialog`). Antes el cliente registraba el hub como entorno y podía operarlo.
- **Host URL siempre.** `ConnectEnterpriseDialog` pide la URL del host a todos, también a quien lo hospeda; si es la de su propio servidor, entra sin enlazarse a sí mismo.
- **Agentes del hub.** Los agentes que corren en el propio hub no traen sesión de cliente: usan la sesión `enterprise-host-agents`, que `HubTeamReporter` liga al primer admin autorizado al arrancar. Así `enterprise_team_list` y `enterprise_team_get` funcionan sin que la UI inicie sesión.
- **Continuar una conversación.** "Continue in my thread" crea un hilo nuevo sin proyecto (Scratch, o el proyecto más antiguo si Scratch no está disponible porque la carpeta de datos está dentro de un repo) con el modelo del hilo nuevo.
- **HTTP plano en LAN sin token.** `resolveEnterpriseHubOrigin(input, { tokenless })` y `PeerLinks` aceptan `http://` en una red privada solo cuando no viaja un token reutilizable ni un código de pairing. Los enlaces normales entre entornos siguen exigiendo HTTPS, loopback o Tailscale.
- **Herramientas de dev.** `vp run dev:enterprise` imprime pair links por miembro con `T3CODE_DEV_AUTH_TOKEN`. `vp run dev:hub` y `dev:hub:desktop`, más `hub.sh`, levantan un hub con su propio home en `~/.t3-hub` y el seed Acme Bank.

## Levantar el hub

```sh
./hub.sh
```

Abre el hub como app de escritorio con datos en `~/.t3-hub`. Pasos:

1. Mirar el puerto real: la línea `[dev-runner] ... serverPort=` o `lsof -iTCP -sTCP:LISTEN -P -n`. Cambia según qué otros servidores haya abiertos (13773 o 13774).
2. Autorizar los emails en Settings → Enterprise → Members.
3. Comprobar que responde por la red: `curl http://<ip>:<puerto>/.well-known/t3/environment` debe dar un JSON con `enterpriseOnboarding: true`.

## Conectar a un compañero

En su compu, dentro del repo:

```sh
git pull && ./node_modules/.bin/vp i && ./node_modules/.bin/vp run dev:desktop --home-dir ~/.t3-friend
```

Luego, en su T3:

1. Eliminar de Settings → Environments cualquier entorno viejo del hub.
2. Connect Enterprise: pegar `http://<ip>:<puerto>`, escribir su email, dejar el token vacío.

Debe estar en la misma red que el hub. El hub debe estar abierto.

## Trampas encontradas

- **Firewall de macOS.** Con `vp run dev` (servidor `node` de Homebrew) el hub escucha en `0.0.0.0`, pero la LAN recibe "Empty reply from server": el firewall bloquea `node`. Un servidor mínimo de `node` en otro puerto falla igual. La app de Electron ya está permitida, por eso el hub de escritorio sí responde. Alternativas: permitir `node` con `socketfilterfw`, o usar T3 Connect/Tailscale.
- **Puerto cambiante.** Se deriva de la ruta del home y de los puertos ocupados. Verificar antes de mandar la dirección.
- **Dos servidores sobre el mismo home.** `ServerAlreadyRunningError` si hay otro hub en `~/.t3-hub`, o un dev sobre `~/.t3`. No arrancar nada contra `~/.t3` (datos reales).
- **Ventanas que se reinician.** `dev:desktop` recarga Electron cuando cambia el código. Con el hub abierto, no editar el repo.
- **Pantalla de pairing.** Cada instancia dev pide un token de pairing la primera vez. Con `T3CODE_DEV_AUTH_TOKEN` en `.env` basta pegarlo una vez por navegador.
- **Run on solo muestra el servidor.** El selector lista solo los entornos que tienen ese proyecto. Para correr en la compu propia, el proyecto debe existir también ahí (clonar el repo).

## Qué no se hizo / no se probó

- El flujo completo con dos IDEs en máquinas distintas.
- Que el token de solo lectura que recibe el servidor del compañero no exponga más que las herramientas de Enterprise.
- Que los adjuntos de una conversación compartida lleguen al hub.
- **Pendiente:** volver a exigir token o autenticación real antes de exponer el hub fuera de una red de confianza; mover el hub a una VM.

## Seguridad

Con solo el email, quien conozca el de otro puede entrar como esa persona. Aceptable en una red de confianza para un hackathon entre conocidos; no para exponerlo.
