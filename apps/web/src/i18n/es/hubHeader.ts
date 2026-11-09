// Spanish strings for the team hub screens (HubHeader). Keys are the exact English text passed to t().
export const ES_HUB_HEADER: Readonly<Record<string, string>> = {
  // Role labels shown as a badge or in a list, via t(role, undefined, "role").
  // The plain "admin"/"member" entries in settings.ts stay lowercase for mid-sentence use.
  "role::admin": "Admin",
  "role::lead": "Líder",
  "role::member": "Miembro",
  // Chat header pill and approvals tab when the user has proposals to review.
  "To approve · {count}": "Por aprobar · {count}",
  "To approve ({count})": "Por aprobar ({count})",
};
