export type Role = "super_admin" | "editor" | "viewer";

export interface AdminUser {
  id: string;            // FK to auth.users.id
  email: string;
  role: Role;
  created_at: string;
}

export interface AdminInvitation {
  id: string;
  email: string;
  role: Role;
  invited_by: string | null;
  accepted_at: string | null;
  created_at: string;
}

export const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  editor: 2,
  super_admin: 3,
};

export function roleAtLeast(have: Role, need: Role): boolean {
  return ROLE_RANK[have] >= ROLE_RANK[need];
}
