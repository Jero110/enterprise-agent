// Spanish strings for the chat area. Keys are the exact English text passed to t().
export const ES_CHAT: Readonly<Record<string, string>> = {
  // Empty state
  "What can I help you with today?": "¿En qué te ayudo hoy?",
  "Project:": "Proyecto:",
  "No project": "Sin proyecto",
  "Choose a project": "Elige un proyecto",
  "Add a project": "Agrega un proyecto",
  "Search projects": "Buscar proyectos",
  "Search projects...": "Buscar proyectos…",
  "No matching projects.": "No hay proyectos con ese nombre.",
  "or start without a project": "o empieza sin proyecto",
  "to start": "para empezar",
  "Add a project to start": "Agrega un proyecto para empezar",

  // Composer
  "Ask anything. @ files, $ skills, / commands":
    "Pregúntame lo que quieras. Usa @ para archivos y / para comandos",
  "Ask anything...": "Pregúntame lo que quieras…",
  "Expand composer": "Abrir cuadro de mensaje",
  "Send message": "Enviar mensaje",
  "Resume thread": "Continuar chat",
  "Open composer to compact and send": "Abre el cuadro de mensaje para resumir y enviar",
  "Select at least one model.": "Elige al menos un modelo.",
  "Compacting is unavailable right now": "Por ahora no se puede resumir la conversación",
  "Enable a provider in Settings": "Activa un agente de IA en Configuración",
  "Enable a provider in Settings to send a message":
    "Activa un agente de IA en Configuración para enviar mensajes",
  "Choose a project above to start a thread": "Elige un proyecto arriba para empezar un chat",
  "Send feedback to decline this request": "Escribe por qué rechazas esta solicitud",
  "Send a message to decline and redirect the agent":
    "Escribe un mensaje para rechazar y darle otra indicación al agente",
  "Choose an option above": "Elige una opción de arriba",
  "Type your own answer, or leave this blank to use the selected option":
    "Escribe tu respuesta, o déjalo vacío para usar la opción elegida",
  "Add feedback to refine the plan, or leave this blank to implement it":
    "Escribe cómo mejorar el plan, o déjalo vacío para llevarlo a cabo",
  "Finding pull request...": "Buscando solicitud de cambios…",
  "Searching workspace skills...": "Buscando habilidades…",
  "Searching workspace files...": "Buscando archivos…",
  "Update this server to send files with question answers":
    "Actualiza el servidor para enviar archivos junto con tus respuestas",
  "Attach the interrupted file again or remove it": "Vuelve a adjuntar el archivo o quítalo",
  "Attach the interrupted files again or remove them": "Vuelve a adjuntar los archivos o quítalos",
  "Still compressing a pasted image.": "Todavía estamos procesando la imagen que pegaste.",
  "Send again once its thumbnail appears.": "Envía de nuevo cuando aparezca la miniatura.",
  "Still bringing attached context into this message.":
    "Todavía estamos agregando lo que adjuntaste.",
  "Send again once its chip resolves.": "Envía de nuevo cuando termine de cargar.",
  "Folders can only be referenced on a server running on this computer":
    "Solo puedes usar carpetas cuando el servidor corre en esta computadora",
  'Couldn\'t get the path of "{name}"': 'No se pudo leer la ubicación de "{name}"',
  "Type the folder path with @ instead.": "Mejor escribe la ruta de la carpeta con @.",
  "Unable to add folder": "No se pudo agregar la carpeta",
  "The composer is busy; try again once it is ready.":
    "El cuadro de mensaje está ocupado; intenta de nuevo en un momento.",
  "Unable to add to chat": "No se pudo agregar al chat",
  "Loading thread context…": "Cargando el chat…",
  "Unable to read the dropped thread": "No se pudo leer el chat que soltaste",
  "This thread exceeds the attachment size limit. Try a shorter thread.":
    "Ese chat es demasiado grande para adjuntarlo. Prueba con uno más corto.",
  "Check that its environment is connected and up to date, then try again.":
    "Revisa que esté conectado y actualizado, y vuelve a intentar.",
  "Unable to add thread": "No se pudo agregar el chat",

  // Send blocked reasons
  "This connection cannot change threads.": "Esta conexión no puede modificar chats.",
  "Preparing machine": "Preparando la computadora",
  "Rewinding conversation": "Regresando la conversación",
  "Sending feedback": "Enviando comentarios",
  "Messages loading": "Cargando mensajes",
  "Preparing worktree": "Preparando la copia de trabajo",

  Permissions: "Permisos",
  "Permissions: {mode}": "Permisos: {mode}",
  "Permissions: {mode}. {description}": "Permisos: {mode}. {description}",
  Supervised: "Pide permiso",
  "Ask before commands and file changes.":
    "El agente te pregunta antes de ejecutar comandos o cambiar archivos.",
  "Auto-accept edits": "Edita sin preguntar",
  "Auto-approve edits, ask before other actions.":
    "El agente cambia archivos sin preguntar, pero te pide permiso para todo lo demás.",
  Auto: "Automático",
  "Supported providers approve routine actions; others still ask.":
    "El agente aprueba solo lo rutinario; para lo demás te pregunta.",
  "Full access": "Acceso total (edita y corre comandos)",
  "Allow commands and edits without prompts.":
    "El agente puede editar archivos y ejecutar comandos sin pedirte permiso. Úsalo solo en proyectos de confianza.",
  "Plan mode. Click to return to normal build mode":
    "Modo plan: el agente solo propone un plan. Haz clic para volver al modo normal",
  "Default mode. Click to enter plan mode":
    "Modo normal: el agente hace el trabajo. Haz clic para pedir solo un plan",
  Plan: "Plan",
  Build: "Hacer",

  // Where the agent works (checkout / worktree / branch)
  "Current checkout": "Carpeta actual",
  "New worktree": "Copia de trabajo nueva",
  "Current worktree": "Copia de trabajo actual",
  Worktree: "Copia de trabajo",
  "Local checkout": "Carpeta local",
  "Where the agent works": "Dónde trabaja el agente",
  "The agent works directly in your project folder.":
    "El agente trabaja directo en la carpeta de tu proyecto.",
  "The agent works on a separate copy, so your folder stays untouched until you decide.":
    "El agente trabaja en una copia aparte; tu carpeta no cambia hasta que tú decidas.",
  "The agent works in this chat's own copy of the project.":
    "El agente trabaja en la copia del proyecto que es solo de este chat.",
  "Each model starts in its own worktree.": "Cada modelo empieza en su propia copia de trabajo.",
  "Run on": "Ejecutar en",
  "Auto balance": "Repartir automáticamente",
  "Add to another machine": "Agregar a otra computadora",
  "Copy full path": "Copiar ubicación completa",
  "Path copied": "Ubicación copiada",
  "Failed to copy path": "No se pudo copiar la ubicación",
  "Select ref": "Elige una versión",
  "From {branch}": "Desde {branch}",
  "From {branch} (remote)": "Desde {branch} (en línea)",
  "Version (branch) of the project the agent works on: {name}":
    "Versión (rama) del proyecto en la que trabaja el agente: {name}",
  "Loading versions...": "Cargando versiones…",
  "Loading more versions...": "Cargando más versiones…",
  "Showing {shown} of {total} versions": "Mostrando {shown} de {total} versiones",
  "Branch name copied": "Nombre de la versión copiado",
  "Failed to copy branch name": "No se pudo copiar el nombre de la versión",
  "Copy branch name": "Copiar nombre de la versión",
  "Action unavailable": "Acción no disponible",
  "This connection cannot change the thread's branch.":
    "Esta conexión no puede cambiar la versión (rama) de este chat.",
  "Failed to switch ref.": "No se pudo cambiar de versión.",
  "Failed to create and switch ref.": "No se pudo crear la versión nueva.",
  'Create new version "{name}"': 'Crear versión nueva "{name}"',

  // Model picker effort words
  Low: "Bajo",
  Medium: "Medio",
  High: "Alto",
  "Extra high": "Muy alto",
  Max: "Máximo",
  Minimal: "Mínimo",

  // Chat header
  "Thread title cannot be empty": "El nombre del chat no puede quedar vacío",
  "Failed to rename thread": "No se pudo cambiar el nombre del chat",
  "New thread in {project}": "Nuevo chat en {project}",
  "Open parent thread: {title}": "Abrir chat original: {title}",
  "Thread title": "Nombre del chat",
  "Thread actions for {title}": "Opciones del chat {title}",
  "Started by an agent on {origin} through a linked environment.":
    "Lo inició un agente en {origin} desde otra computadora conectada.",

  // Messages
  You: "Tú",
  Automation: "Automatización",
  "Copy message": "Copiar mensaje",
  "Copy prompt link": "Copiar enlace al mensaje",
  "(empty response)": "(respuesta vacía)",
  "Fork from this response": "Crear un chat nuevo desde esta respuesta",
  "Edit from here": "Editar desde aquí",
  "Show less": "Ver menos",
  "Show full message": "Ver mensaje completo",
  "Sent by {name}": "Enviado por {name}",
  "Sending…": "Enviando…",
  "Sending attachment": "Enviando archivo adjunto",
  "Preview {name}": "Ver {name}",
  "Download {name}": "Descargar {name}",
  "badge::Steer": "Redirigido",
  "Originally queued, then promoted to steer the active turn":
    "Estaba en espera y se usó para redirigir al agente mientras trabajaba",
  "Steered the active turn": "Redirigió al agente mientras trabajaba",

  // Approvals
  "Command approval": "Permiso para ejecutar un comando",
  Command: "Comando",
  "File change approval": "Permiso para cambiar un archivo",
  "File change": "Cambio de archivo",
  "File read approval": "Permiso para leer un archivo",
  "File to read": "Archivo a leer",
  "App permission approval": "Permiso para una app",
  "Permission request": "Solicitud de permiso",
  "App access approval": "Permiso de acceso a una app",
  "App access request": "Solicitud de acceso",
  "Waiting for approval": "Esperando tu permiso",
  "Provider process is gone. Interrupt or restart the run to respond.":
    "El agente de IA se detuvo. Detén o reinicia la tarea para responder.",
  Decline: "Rechazar",
  "Always allow this session": "Permitir siempre en esta sesión",
  Approve: "Aprobar",
  "More approval options": "Más opciones de permiso",

  // Errors
  "Request copied": "Solicitud copiada",
  "Send it to your workspace admin.": "Envíala a quien administra tu cuenta.",
  "Could not copy the request": "No se pudo copiar la solicitud",
  "ChatGPT usage limit reached": "Llegaste al límite de uso de ChatGPT",
  "You've reached your workspace's limit for using your ChatGPT plan in other apps. Copy a request to ask your workspace admin for increased usage limits.":
    "Tu equipo llegó al límite para usar ChatGPT en otras apps. Copia una solicitud para pedirle más uso a quien administra tu cuenta.",
  "Review your usage settings in ChatGPT.": "Revisa tu uso en ChatGPT.",
  "Copy request for admin": "Copiar solicitud para el administrador",
  "Dismiss error": "Cerrar aviso",
  "What should we work on?": "¿En qué te ayudo hoy?",
  "Add a project to start your first thread.": "Agrega un proyecto para empezar tu primer chat.",
  "Add a project, or start without one.": "Agrega un proyecto o empieza sin uno.",
  "Start without a project": "Empezar sin proyecto",
  "timeline::Thinking": "Pensando",
  "timeline::Thought": "Pensó",
};
