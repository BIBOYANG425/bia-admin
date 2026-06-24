"use client";

import { createContext, useContext } from "react";
import { roleAtLeast, type Role } from "@biboyang425/bia-shared";

/**
 * Client-side access to the signed-in officer's role, provided once by
 * AdminShell. Lets any client surface hide/disable write controls for viewers
 * (the API already enforces it; this stops viewers from filling out a form they
 * can't submit). Defaults to the most-restrictive role.
 */
const RoleContext = createContext<Role>("viewer");

export function RoleProvider({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useRole(): Role {
  return useContext(RoleContext);
}

/** True when the current role meets `min` (default "editor" = can write). */
export function useCanWrite(min: Role = "editor"): boolean {
  return roleAtLeast(useContext(RoleContext), min);
}
