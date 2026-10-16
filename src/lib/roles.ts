export const STANDARD_ROLES = ["Partenaire", "Intervenant", "Organisateur"] as const;
export type StandardRole = (typeof STANDARD_ROLES)[number];

export function isStandardRole(role: string): role is StandardRole {
  return (STANDARD_ROLES as readonly string[]).includes(role);
}
