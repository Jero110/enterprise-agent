// Spanish strings for the team hub screens (HubTeam). Keys are the exact English text passed to t().
export const ES_HUB_TEAM: Readonly<Record<string, string>> = {
  // CoWork sidebar section (TeamAgentsSection).
  "CoWork Agents": "Agentes del equipo",
  "Reload CoWork Agents": "Recargar agentes del equipo",
  "Loading team threads…": "Cargando…",
  "No shared conversations yet.": "Nadie ha compartido conversaciones todavía.",
  "{count} shared": "{count} compartidas",
  "teamThread::active": "activa",
  "teamThread::idle": "en pausa",
  "teamThread::archived": "archivada",

  // Read-only shared conversation dialog.
  "Team thread": "Conversación del equipo",
  "Read-only transcript from {name}.": "Conversación de {name}.",
  "Stop sharing": "Dejar de compartir",
  "Stopping sharing…": "Dejando de compartir…",
  "Could not stop sharing": "No se pudo dejar de compartir",
  "Loading transcript…": "Cargando conversación…",
  "teamThread::Summary": "Resumen",
  "The assistant has not replied yet.": "El asistente todavía no ha respondido.",
  "See full conversation": "Ver conversación completa",
  "teamThread::User": "Usuario",
  "teamThread::Assistant": "Asistente",
  "teamThread::System": "Sistema",
  "Take to my chat to summarize": "Llevar a mi chat para resumir",
  "teamThread::Starting…": "Abriendo…",
  "Could not open the continuation thread.": "No se pudo abrir el chat nuevo.",

  // Empty chat (MessagesTimeline).
  "Send a message to start the conversation.": "Escribe un mensaje para empezar.",

  // Hub errors a member can hit, shown through enterpriseFailureMessage (exact server text).
  "The enterprise hub request failed.": "No se pudo completar la solicitud a la empresa.",
  "The environment request failed.": "No se pudo completar la solicitud.",
  "This email is not authorized for this enterprise. Ask an admin to authorize it.":
    "Este correo no tiene acceso a esta empresa. Pide a un administrador que lo autorice.",
  "The enterprise token is wrong.": "El código de invitación no es correcto.",
  "This session is not connected to the enterprise. Connect with your email and token.":
    "Esta sesión no está conectada a la empresa. Conéctate con tu correo y tu código de invitación.",
  "Connect to your enterprise first.": "Primero conéctate a tu empresa.",
  "Connect with your email and Enterprise token first.":
    "Primero conéctate con tu correo y el código de invitación de la empresa.",
  "Connect this environment to Enterprise before reading team conversations.":
    "Conéctate a tu empresa para leer las conversaciones del equipo.",
  "Could not reach the Enterprise hub.": "No se pudo conectar con la empresa.",
  "The Enterprise hub did not answer in time.": "La empresa no respondió a tiempo.",
  "The Enterprise hub could not complete sign-in.":
    "La empresa no pudo completar el inicio de sesión.",
  "The Enterprise hub could not complete sign-in. Update and restart it, then try again.":
    "La empresa no pudo completar el inicio de sesión. Actualízala, reiníciala e inténtalo de nuevo.",
  "The linked environment stopped answering.": "El entorno vinculado dejó de responder.",
  "You cannot act on this proposal.": "No puedes decidir sobre esta propuesta.",
  "Proposal not found.": "No se encontró la propuesta.",
  "This proposal has already been resolved.": "Esta propuesta ya se resolvió.",
  "An access request for this area is already pending.":
    "Ya hay una solicitud de acceso pendiente para esta área.",
  "A create proposal for this document is already pending.":
    "Ya hay una propuesta pendiente para crear este documento.",
  "The destination document already exists.": "El documento de destino ya existe.",
  "Document not found.": "No se encontró el documento.",
  "You do not have access to this document.": "No tienes acceso a este documento.",
  "You already have access to this area.": "Ya tienes acceso a esta área.",
  "This area is not available to this conversation.":
    "Esta área no está disponible para esta conversación.",
  "Only enterprise admins can manage members.":
    "Solo los administradores de la empresa pueden gestionar miembros.",
  "You can only view your own usage or your team's usage.":
    "Solo puedes ver tu propio uso o el de tu equipo.",
  "This conversation is not published.": "Esta conversación ya no está compartida.",
  "The owner's IDE has not uploaded this snapshot yet.":
    "Esta conversación todavía no se ha subido. Inténtalo en un momento.",
  "Only the conversation's owner can change sharing.":
    "Solo quien creó la conversación puede cambiar cómo se comparte.",
  "Unpublish the parent thread first.": "Primero deja de compartir la conversación principal.",
  // Chat timeline status labels.
  "Worked for {duration}": "Trabajó {duration}",
  Worked: "Trabajó",
  "Working for": "Trabajando",
  "You stopped after {duration}": "Lo detuviste tras {duration}",
  "You stopped this response": "Detuviste esta respuesta",
  "{name} (guest)": "{name} (invitado)",
  // Chat options menu (context key threadMenu).
  "threadMenu::Archive thread": "Archivar chat",
  "threadMenu::Auto-settle behavior": "Terminar solo",
  "threadMenu::Branch": "Rama",
  "threadMenu::Copy": "Copiar",
  "threadMenu::Custom…": "Personalizado…",
  "threadMenu::Delete": "Eliminar",
  "threadMenu::Disabled": "Desactivado",
  "threadMenu::Discard draft": "Descartar borrador",
  "threadMenu::Enabled": "Activado",
  "threadMenu::Find in thread": "Buscar en el chat",
  "threadMenu::Mark unread": "Marcar como no leído",
  "threadMenu::Path": "Ruta",
  "threadMenu::Pin thread": "Fijar chat",
  "threadMenu::Project settings": "Configuración del proyecto",
  "threadMenu::Read-only": "Solo lectura",
  "threadMenu::Rename thread": "Cambiar nombre",
  "threadMenu::Settle thread": "Marcar como terminado",
  "threadMenu::Share with guest": "Compartir con un invitado",
  "threadMenu::Snooze": "Posponer",
  "threadMenu::Team publication": "Compartir con el equipo",
  "threadMenu::Thread": "Chat",
  "threadMenu::Thread ID": "ID del chat",
  "threadMenu::Turn into project": "Convertir en proyecto",
  "threadMenu::Un-settle thread": "Marcar como pendiente",
  "threadMenu::Unpin thread": "Dejar de fijar",
  "threadMenu::Unpublished": "No compartido",
  "threadMenu::Wake thread": "Reactivar chat",
  "threadMenu::New thread on {branch}": "Chat nuevo en {branch}",
  "threadMenu::Regenerating…": "Generando…",
  "threadMenu::Regenerate title": "Generar otro título",
  "threadMenu::Show all projects": "Mostrar todos los proyectos",
  "threadMenu::Filter by {project}": "Filtrar por {project}",
};
