// Spanish strings for the settings area. Keys are the exact English text passed to t().
export const ES_SETTINGS: Readonly<Record<string, string>> = {
  // Navigation, breadcrumb and frame
  Settings: "Configuración",
  "Settings sections": "Secciones de configuración",
  "Settings content": "Contenido de configuración",
  "Settings breadcrumb": "Ruta de configuración",
  Search: "Buscar",
  "Search settings": "Buscar en configuración",
  "Clear settings search": "Borrar búsqueda",
  "No settings found": "No encontramos opciones",
  "Settings search results": "Resultados de búsqueda",
  "Show advanced settings": "Mostrar opciones avanzadas",
  "Show developer sections in the settings menu. Off keeps the menu short.":
    "Muestra en el menú las secciones para desarrolladores. Apagado, el menú queda corto y sencillo.",
  "Restore device defaults": "Restaurar valores de este equipo",
  "Reconnect {name} to change its settings.":
    "Vuelve a conectar {name} para cambiar su configuración.",
  Agents: "Agentes",
  Code: "Código",
  Connections: "Conexiones",

  // Section names
  General: "General",
  Appearance: "Apariencia",
  Chat: "Chat",
  "Diffs & pull requests": "Cambios y revisiones",
  Keybindings: "Atajos de teclado",
  SnapShots: "Capturas",
  Providers: "Agentes de IA",
  Threads: "Chats",
  Browser: "Navegador",
  Devices: "Dispositivos",
  "Scheduled tasks": "Tareas programadas",
  "Source control": "Control de versiones",
  Worktrees: "Copias de trabajo",
  Environments: "Computadoras",
  "Sharing & access": "Compartir y acceso",
  Secrets: "Claves secretas",
  Enterprise: "Empresa",
  Maintenance: "Mantenimiento",
  Labs: "Experimentos",
  About: "Acerca de",
  Archive: "Archivo",
  Projects: "Proyectos",
  Diagnostics: "Diagnóstico",
  "Open source licenses": "Licencias de código abierto",

  // Shared row bits
  "Reset to default": "Volver al valor original",
  "Reset to inherited value": "Volver al valor heredado",
  "Managed by {name}.": "Lo administra {name}.",
  "Reconnect the selected environment to change this setting.":
    "Vuelve a conectar la computadora elegida para cambiar esta opción.",
  "Environment-wide setting. Select an environment to change it.":
    "Esta opción aplica a toda la computadora. Elige una para cambiarla.",
  Advanced: "Avanzado",
  "Loading…": "Cargando…",

  // General: language
  Language: "Idioma",
  "Choose the app language. The app reloads to apply it.":
    "Elige el idioma de la app. La app se recarga para aplicarlo.",

  // General: notifications
  Notifications: "Notificaciones",
  "Thread notifications": "Avisos de chats",
  "System alerts when a thread finishes, fails, or needs input or approval. Applies to this device while {app} is open.":
    "Avisos del sistema cuando un chat termina, falla o necesita tu respuesta o aprobación. Aplica en este equipo mientras {app} esté abierto.",
  "Notifications need a supported browser over HTTPS, or the desktop app. Sound only is still available.":
    "Las notificaciones necesitan un navegador compatible con HTTPS o la app de escritorio. Puedes usar solo sonido.",
  "Notifications are unavailable in this browser. Sound only is still available.":
    "Este navegador no permite notificaciones. Puedes usar solo sonido.",
  "Allow notifications in your browser or system settings, then choose this option again. Sound only is still available.":
    "Permite las notificaciones en tu navegador o sistema y vuelve a elegir esta opción. Puedes usar solo sonido.",
  Off: "Apagado",
  "Notifications only": "Solo notificaciones",
  "Sound only": "Solo sonido",
  "Notifications with sound": "Notificaciones con sonido",
  "In-app notifications": "Avisos dentro de la app",
  "Show a toast when another thread finishes, fails, or needs input or approval while this app has focus.":
    "Muestra un aviso cuando otro chat termina, falla o necesita tu respuesta mientras usas la app.",

  // General: sidebar
  Sidebar: "Barra lateral",
  "Project grouping": "Agrupar proyectos",
  "Combine matching repositories across environments.":
    "Junta los proyectos iguales aunque estén en distintas computadoras.",
  "Project order": "Orden de proyectos",
  "Order of projects in the sidebar project picker and command palette.":
    "Cómo se ordenan los proyectos en la barra lateral y en el buscador de comandos.",
  "Last user message": "Último mensaje",
  "Created at": "Fecha de creación",
  Manual: "Manual",
  "Working section": "Sección «Trabajando»",
  "Fold working and monitoring threads into a Working section. They return to the top of the inbox when they need you. The boring sidebar in Labs has no Working section.":
    "Agrupa en «Trabajando» los chats que están en curso. Vuelven arriba cuando te necesitan.",

  // General: confirmations
  Confirmations: "Confirmaciones",
  "Unpin confirmation": "Confirmar al desfijar",
  "Ask before unpinning a thread from the pinned section.":
    "Pregunta antes de quitar un chat de los fijados.",
  "Confirm thread unpinning": "Confirmar al desfijar chats",
  "Archive confirmation": "Confirmar al archivar",
  "Require a second click on the inline archive action before a thread is archived.":
    "Pide un segundo clic antes de archivar un chat.",
  "Confirm thread archiving": "Confirmar al archivar chats",
  "Delete confirmation": "Confirmar al borrar",
  "Ask before deleting a thread and its chat history.":
    "Pregunta antes de borrar un chat y su historial.",
  "Confirm thread deletion": "Confirmar al borrar chats",
  "Quit shortcut": "Atajo para salir",
  "Quit shortcut behavior": "Cómo funciona el atajo para salir",
  "Hold mode also quits on two quick presses.":
    "En modo «mantener», también sales con dos toques rápidos.",
  Direct: "Directo",
  Hold: "Mantener",
  "Double press": "Doble toque",

  // General: display
  Display: "Pantalla",
  "Time format": "Formato de hora",
  "Timestamp format": "Formato de hora",
  "System default follows your browser or OS clock preference.":
    "«Como el sistema» usa el formato de reloj de tu navegador o computadora.",
  "System default": "Como el sistema",
  "12-hour": "12 horas",
  "24-hour": "24 horas",

  // Chat
  Composer: "Caja de mensaje",
  "Rich text composer": "Texto con formato",
  "Show formatted Markdown as you type.":
    "Muestra el formato (negritas, listas…) mientras escribes.",
  "Send shortcut": "Tecla para enviar",
  "Choose when Enter sends a prompt or inserts a new line":
    "Elige si Enter envía el mensaje o agrega una línea nueva",
  "{modifier} + Enter for multiline prompts": "{modifier} + Enter en mensajes de varias líneas",
  "{modifier} + Enter always": "Siempre {modifier} + Enter",
  "Show skills in slash menu": "Mostrar habilidades en el menú /",
  "Also include skills in the / command menu. Skills always appear when you type $.":
    "Incluye las habilidades en el menú de /. Siempre aparecen al escribir $.",
  "Follow-ups": "Mensajes de seguimiento",
  "Follow-up behavior": "Qué pasa si escribes mientras trabaja",
  "Queue follow-ups while the agent runs or steer the current run.":
    "Mientras el agente trabaja, tus mensajes esperan su turno (en fila) o cambian lo que está haciendo (redirigir).",
  "Press {modifier} + Enter for single-line prompts or {modifier} + Shift + Enter for multiline prompts to do the opposite for one message.":
    "Presiona {modifier} + Enter (una línea) o {modifier} + Shift + Enter (varias líneas) para hacer lo contrario en un mensaje.",
  "Press {keys} + Enter to do the opposite for one message.":
    "Presiona {keys} + Enter para hacer lo contrario en un mensaje.",
  Queue: "En fila",
  Steer: "Redirigir",
  Legacy: "Funciones anteriores",

  // Appearance
  "Colors & themes": "Colores y temas",
  "Color scheme": "Modo de color",
  Themes: "Temas",
  System: "Sistema",
  Light: "Claro",
  Dark: "Oscuro",
  Interface: "Interfaz",
  Contrast: "Contraste",
  "Adjust the contrast of colors and borders across the interface.":
    "Ajusta el contraste de colores y bordes en toda la app.",
  "Glass opacity": "Transparencia",
  "Higher values make menus, dialogs, and the composer more solid.":
    "Con valores más altos, los menús y ventanas se ven más sólidos.",
  "Chat width": "Ancho del chat",
  "Set how wide messages and the composer can grow on large screens.":
    "Qué tan anchos se ven los mensajes en pantallas grandes.",
  Comfortable: "Cómodo",
  "Comfortable (default)": "Cómodo (recomendado)",
  Wide: "Ancho",
  Full: "Completo",
  "Thread details": "Detalles del chat",
  "Choose what the thread details card shows. You can also right-click the card.":
    "Elige qué muestra la tarjeta de detalles del chat. También puedes darle clic derecho.",
  "Effort display": "Cómo mostrar el esfuerzo",
  "Show reasoning effort in the composer as its name, such as High, or as bars.":
    "Muestra cuánto «piensa» el agente como palabra (por ejemplo, Alto) o como barras.",
  Word: "Palabra",
  "Word (default)": "Palabra (recomendado)",
  Bars: "Barras",
  "Render math": "Mostrar fórmulas",
  "Typeset LaTeX math, such as $x^2$ or \\[x^2\\], in messages and Markdown previews. The composer keeps TeX source editable.":
    "Muestra las fórmulas matemáticas bien formateadas en los mensajes.",
  "Panel animations": "Animaciones",
  "Panel animation duration": "Duración de las animaciones",
  "Set how fast panels open and close.": "Qué tan rápido se abren y cierran los paneles.",
  "Environment identification": "Identificar la computadora",
  "Choose how Dev and Nightly environments are identified.":
    "Cómo se distinguen las versiones de prueba.",
  "Show Dev or Nightly artwork in the sidebar header.":
    "Muestra un dibujo de versión de prueba arriba en la barra lateral.",
  "Only built-in themes show artwork.": "Solo los temas incluidos muestran el dibujo.",
  "Only built-in themes show artwork, so this theme shows the version pill.":
    "Solo los temas incluidos muestran el dibujo; este tema muestra la etiqueta de versión.",
  Artwork: "Dibujo",
  "Nightly artwork": "Dibujo de prueba nocturna",
  "Dev artwork": "Dibujo de desarrollo",
  "Version pill": "Etiqueta de versión",
  None: "Ninguno",
  "Composer context": "Contexto bajo la caja de mensaje",
  "Keep branch and worktree controls below the composer after a thread starts.":
    "Deja visibles los controles de rama y copia de trabajo después de empezar un chat.",
  "Keep composer context visible in active threads": "Mantener contexto visible en chats activos",
  Typography: "Tipografía",
  "Interface font": "Letra de la interfaz",
  "Everything outside code blocks and the terminal.": "Todo lo que no es código ni terminal.",
  "Prompt font": "Letra de la caja de mensaje",
  "Only the box you write prompts in. Mono works well here.":
    "Solo la caja donde escribes tus mensajes.",
  "Code font": "Letra del código",
  "Terminal font": "Letra de la terminal",
  "Terminal output, independent from code blocks and diffs.":
    "Texto de la terminal, aparte del código.",
  "Separate fonts": "Letras separadas",
  "Set the prompt, code, and terminal fonts separately instead of one monospace font.":
    "Elige una letra distinta para mensajes, código y terminal.",
  "Monospace font": "Letra de ancho fijo",
  "Code blocks, diffs, file previews, and the terminal.":
    "Código, cambios, vistas de archivos y terminal.",
  "Font smoothing": "Suavizado de letra",
  "Use thinner grayscale text smoothing instead of the macOS default.":
    "Usa un suavizado más delgado en lugar del de macOS.",
  "Word wrap": "Ajustar líneas",
  "Wrap long lines in code blocks, diffs, and file previews by default.":
    "Parte las líneas largas para que quepan en pantalla.",

  // Providers (AI agents)
  "Add provider": "Agregar agente de IA",
  "Refresh provider status": "Revisar estado de los agentes",
  "Refreshing providers": "Revisando agentes",
  "Limited permissions": "Permisos limitados",
  "This session can view {name}'s providers but can't change their settings.":
    "Puedes ver los agentes de IA de {name}, pero no cambiar su configuración.",
  "This provider instance is no longer available on this device.":
    "Este agente de IA ya no está disponible en este equipo.",
  "No providers configured.": "Todavía no hay agentes de IA configurados.",
  "Device unavailable": "Equipo no disponible",
  "Reconnect this device to set up its provider, or select another device.":
    "Vuelve a conectar este equipo para configurar su agente, o elige otro.",
  "Usage providers": "Límites de uso",
  "Health check interval": "Cada cuánto revisar los agentes",
  "Refresh provider status, versions, and models in the background. Set to 0 to disable.":
    "Revisa en segundo plano el estado, versión y modelos de los agentes. Pon 0 para desactivarlo.",

  // Threads
  "New projects": "Proyectos nuevos",
  "Add project starts in": "Carpeta inicial al agregar proyecto",
  Snooze: "Posponer",
  "Snooze options": "Opciones para posponer",
  "Usage limits": "Límites de uso",
  "Resume after usage limits": "Continuar al renovarse el límite",
  "Automatically resume threads when their usage limits reset. You can cancel auto-resume in each thread.":
    "Retoma los chats solos cuando se renueva tu límite de uso. Puedes cancelarlo en cada chat.",
  "Snooze until limits reset": "Posponer hasta que se renueve el límite",
  "Snooze threads until their usage limits reset. Enable auto-resume to continue the agent after the reset.":
    "Pospone los chats hasta que se renueve tu límite de uso.",
  "Auto-settle": "Cerrar chats solos",
  "Auto-settle merged threads": "Cerrar chats al aprobar sus cambios",
  "Auto-settle inactive threads": "Cerrar chats inactivos",
  "Sidebar threads with no activity for this long settle automatically.":
    "Los chats sin actividad durante este tiempo se cierran solos.",
  "Days of inactivity before auto-settle": "Días sin actividad antes de cerrar",
  "Any new activity un-settles a thread automatically.":
    "Cualquier actividad nueva vuelve a abrir el chat.",
  "Keep threads with a PR": "Conservar chats con revisión abierta",
  "Compact idle threads": "Resumir chats inactivos",
  "Text generation": "Generación de texto",
  "Text generation model": "Modelo para títulos",
  "Used for thread titles and other generated text on connected devices with this provider. Source control can override it.":
    "Se usa para poner título a los chats y otros textos automáticos.",
  "Thread title instructions": "Instrucciones para títulos",
  "Appended to the prompt for new and regenerated thread titles.":
    "Se agregan a la instrucción al crear títulos de chats.",
  "Response streaming": "Cómo aparecen las respuestas",

  // Enterprise
  Members: "Miembros",
  "No team": "Sin equipo",
  Disconnect: "Desconectar",
  "Disconnecting…": "Desconectando…",
  "Not connected": "Sin conectar",
  "Connect with your work email and a one-time Enterprise invite. Nothing changes here until you do.":
    "Conéctate con tu correo del trabajo y una invitación de un solo uso. Nada cambia hasta que lo hagas.",
  "Connect Enterprise": "Conectar con mi empresa",
  "The hub did not confirm your access": "El servidor de la empresa no confirmó tu acceso",
  "Create an invite": "Crear una invitación",
  "Manage existing members": "Administrar miembros",
  "Could not load members": "No se pudieron cargar los miembros",
  "Loading members…": "Cargando miembros…",
  "Create an Enterprise invite": "Crear invitación de empresa",
  "On the hub, get a fresh pairing code in Connections. Use its HTTPS or Tailscale address. Each code works once. The invite contains the reusable Enterprise token (encoded, not encrypted); share it privately.":
    "En el servidor de la empresa, saca un código nuevo en Conexiones y usa su dirección HTTPS o Tailscale. Cada código sirve una sola vez. La invitación incluye la clave de la empresa, así que compártela en privado.",
  "Enter the hub address, pairing code and Enterprise token.":
    "Escribe la dirección del servidor, el código y la clave de la empresa.",
  "Hub address": "Dirección del servidor",
  "Hub pairing code": "Código de vinculación",
  "Fresh pairing code": "Código nuevo",
  "Enterprise token": "Clave de la empresa",
  "Create invite": "Crear invitación",
  "Enterprise invite": "Invitación de empresa",
  Copy: "Copiar",
  Team: "Equipo",
  Role: "Rol",
  admin: "administrador",
  member: "miembro",
  "Could not update the member": "No se pudo actualizar al miembro",
  revoked: "acceso retirado",
  "Additional areas": "Áreas adicionales",
  "Could not revoke the email": "No se pudo retirar el acceso",
  Revoke: "Retirar acceso",
  Authorize: "Dar acceso",
  "Could not authorize the email": "No se pudo dar acceso a ese correo",
  "Add a member": "Agregar un miembro",
  "Enter their email. They join the default team and can connect with a one-time Enterprise invite.":
    "Escribe su correo. Entra al equipo principal y se conecta con una invitación de un solo uso.",
  Email: "Correo",
  email: "correo",
  "Add member": "Agregar miembro",

  // About
  App: "App",
  Organization: "Organización",
  "This environment is managed by {organization}. Some settings and features follow its policy.":
    "{organization} administra esta computadora. Algunas opciones siguen sus reglas.",
  "Get help": "Pedir ayuda",
  Version: "Versión",
  "Current version of the application.": "Versión actual de la app.",
  "Update available.": "Hay una actualización disponible.",
  Download: "Descargar",
  Install: "Instalar",
  "Checking…": "Buscando…",
  "Downloading…": "Descargando…",
  "Up to Date": "Al día",
  "Check for Updates": "Buscar actualizaciones",
  "Update track": "Canal de actualizaciones",
  "Mobile app": "App para celular",
  "Connect to your server from your phone or tablet.": "Conéctate desde tu celular o tableta.",
  Legal: "Legal",
  "Privacy policy": "Aviso de privacidad",
  "How we handle your data, including the anonymous usage data {app} collects.":
    "Cómo cuidamos tus datos, incluidos los datos anónimos de uso que recopila {app}.",
  "How we handle your data.": "Cómo cuidamos tus datos.",
  "View policy": "Ver aviso",
  "Notices for dependencies, assets, and optional tools used by {app}.":
    "Avisos de los componentes y herramientas que usa {app}.",
  "View licenses": "Ver licencias",
};
