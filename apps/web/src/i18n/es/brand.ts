// Spanish strings for app-wide messages that used to name T3 Code. Keys are the exact English text passed to t().
// `{app}` is the app name (APP_BASE_NAME), filled in where the text is shown.
export const ES_BRAND: Readonly<Record<string, string>> = {
  // Onboarding and first run
  "{app} could not confirm this workspace.": "{app} todavía no puede abrir tu espacio de trabajo.",
  "{app} collects anonymous usage data to help us improve it.":
    "{app} guarda datos de uso anónimos para mejorar.",
  "Keep {app} running. Select the computers you want to set up above.":
    "Deja {app} abierto y elige arriba las computadoras que quieres preparar.",
  "On the computer with your code, start {app} or run":
    "En la computadora con tus archivos, abre {app} o corre",
  "Remote connection": "Conexión remota",

  // Home without a computer
  "This computer is off": "Esta computadora está apagada",
  "No computer connected": "No hay ninguna computadora conectada",
  "Turn it back on, or connect a different computer.":
    "Vuelve a encenderla o conecta otra computadora.",
  "Your agents run on your computer.": "Tus agentes trabajan en tu computadora.",
  "Your agents run on your computer. Open {app} there first.":
    "Tus agentes trabajan en tu computadora. Primero abre {app} ahí.",

  // Command palette and triage
  "An agent looks into a problem with {app} and helps you report it":
    "Un agente revisa un problema de {app} y te ayuda a reportarlo",
  "The agent reads {app}'s logs and code on this computer, and asks before it applies a fix or posts anything.":
    "El agente revisa los registros y el código de {app} en esta computadora, y te pregunta antes de arreglar o publicar algo.",
  "{app} could not open a new chat.": "{app} no pudo abrir un chat nuevo.",

  // Side chats and pull requests
  "Update {app} on this computer to use side chats.":
    "Actualiza {app} en esta computadora para usar chats paralelos.",
  "Pull requests unavailable": "Propuestas de cambios no disponibles",
  "Update {app} on this computer to see pull requests.":
    "Actualiza {app} en esta computadora para ver las propuestas de cambios.",
  "Update {app} on your computers to see pull requests.":
    "Actualiza {app} en tus computadoras para ver las propuestas de cambios.",

  // Machines
  "Computer connected to {app}": "Computadora conectada a {app}",
  "Computer not in this app": "Computadora que no está en esta app",

  // Preview
  "Browser previews are only available in the desktop app.":
    "La vista del navegador solo está disponible en la app de escritorio.",
  "Preview is only available in the desktop app.":
    "La vista previa solo está disponible en la app de escritorio.",
  "Pair this client again with preview access to control browser previews.":
    "Vuelve a conectar este equipo con permiso para usar la vista previa.",
  "This tab is open in the desktop app.": "Esta pestaña está abierta en la app de escritorio.",
  "Preview is desktop-only": "La vista previa es solo para escritorio",
  "Open {app} in the desktop app to use the preview.":
    "Abre {app} en la app de escritorio para usar la vista previa.",

  // Desktop app
  "{app} could not add the project.": "{app} no pudo agregar el proyecto.",
  "{app} could not open a new chat for the project.":
    "{app} no pudo abrir un chat nuevo para el proyecto.",
  "SSH verification required": "Se necesita verificación",
  "Enter the password or verification code that this computer asks for:":
    "Escribe la contraseña o el código de verificación que pide esta computadora:",
  "{app} only passes it to the SSH connection and keeps it in memory for this computer. It never saves it to disk.":
    "{app} solo lo usa para conectarse y lo guarda en memoria para esta computadora. Nunca lo guarda en el disco.",

  // Updates
  "This Mac has Apple Silicon, but {app} is still running the Intel build under Rosetta. Download the available update to switch to the native Apple Silicon build.":
    "Esta Mac tiene un chip Apple, pero {app} sigue usando la versión para Intel. Descarga la actualización disponible para cambiar a la versión hecha para tu Mac.",
  "This Mac has Apple Silicon, but {app} is still running the Intel build under Rosetta. Restart to install the downloaded Apple Silicon build.":
    "Esta Mac tiene un chip Apple, pero {app} sigue usando la versión para Intel. Reinicia para instalar la versión hecha para tu Mac.",
  "This Mac has Apple Silicon, but {app} is still running the Intel build under Rosetta. The next app update will replace it with the native Apple Silicon build.":
    "Esta Mac tiene un chip Apple, pero {app} sigue usando la versión para Intel. La próxima actualización la cambiará por la versión hecha para tu Mac.",
  "Install update {version} and restart {app}?\n\nAny running tasks will be interrupted. Make sure you're ready before continuing.":
    "¿Instalar la actualización {version} y reiniciar {app}?\n\nLo que esté trabajando en este momento se va a detener. Asegúrate de estar listo antes de seguir.",
  "Install the update and restart {app}?\n\nAny running tasks will be interrupted. Make sure you're ready before continuing.":
    "¿Instalar la actualización y reiniciar {app}?\n\nLo que esté trabajando en este momento se va a detener. Asegúrate de estar listo antes de seguir.",
  "Update the {app} desktop app on {computers}? It will close and reopen on those computers.":
    "¿Actualizar la app de escritorio de {app} en {computers}? Se va a cerrar y volver a abrir en esas computadoras.",
  "Update the {app} desktop app on {computer}? It will close and reopen on that computer.":
    "¿Actualizar la app de escritorio de {app} en {computer}? Se va a cerrar y volver a abrir en esa computadora.",
  "Update did not apply": "La actualización no se aplicó",
  "{app} is still on {current}. Install {next} again from the update button.":
    "{app} sigue en la versión {current}. Vuelve a instalar la {next} desde el botón de actualizar.",

  // Remote access helper (relay client)
  "Installing relay client": "Instalando el conector remoto",
  "Install relay client?": "¿Instalar el conector remoto?",
  "{app} is preparing this computer for secure remote access.":
    "{app} está preparando esta computadora para que la uses desde otros dispositivos de forma segura.",
  "{app} needs the relay client so you can reach this computer from your other devices.":
    "{app} necesita el conector remoto para que uses esta computadora desde tus otros dispositivos.",
  "{current} of {total}": "{current} de {total}",
  "Relay client installation progress": "Avance de la instalación del conector remoto",
  "Keep {app} open while the relay client is installed.":
    "Deja {app} abierto mientras se instala el conector remoto.",
  "Managed relay client": "Conector remoto",
  "{app} will download and install version {version} on this computer.":
    "{app} va a descargar e instalar la versión {version} en esta computadora.",
  "Download and install": "Descargar e instalar",
  "Checking current installation": "Revisando la instalación actual",
  "Waiting for installer": "Esperando al instalador",
  "Downloading relay client": "Descargando el conector remoto",
  "Verifying download": "Revisando la descarga",
  "Validating executable": "Revisando el programa",
  "Activating installation": "Activando la instalación",

  // Prompt links
  "Open this chat": "Abrir este chat",
  "It opens in {app} if you're connected to the computer it runs on.":
    "Se abre en {app} si estás conectado a la computadora donde está.",
  "This prompt had hidden characters, it may be malicious":
    "Este mensaje tenía caracteres ocultos; podría ser peligroso",
  "{app} removed 1 hidden character. Read the prompt before you send it.":
    "{app} quitó 1 carácter oculto. Lee el mensaje antes de enviarlo.",
  "{app} removed {count} hidden characters. Read the prompt before you send it.":
    "{app} quitó {count} caracteres ocultos. Lee el mensaje antes de enviarlo.",
  "Get {app}": "Descargar {app}",
  "This computer cannot copy a project from a link. Update {app} on it, or copy the project from the command palette.":
    "Esta computadora no puede copiar un proyecto desde un enlace. Actualiza {app} en ella o copia el proyecto desde la paleta de comandos.",
};
