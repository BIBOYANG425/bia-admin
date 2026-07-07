export * from "./types";
export * from "./articles";
export * from "./students";
export { createBiaBrowserClient } from "./supabase/browser";
// This barrel is pure types + logic — NO React (breaking change, 3.0.0).
// The ArticleRenderer component (and any future React component) lives at:
//   @biboyang425/bia-shared/react
// Keeping React out of the barrel lets pure Node/server consumers import a
// type or helper without dragging in the `react` peer dependency.
// The service-role factory is NOT re-exported from the barrel (breaking
// change, 1.0.0): it carries `import "server-only"`, and client components
// legitimately import this barrel (roleAtLeast etc.). Import it via:
//   @biboyang425/bia-shared/supabase/service-role
// Next-bound helpers are NOT re-exported from the barrel.
// Import them via: @biboyang425/bia-shared/next/supabase/server
//                  @biboyang425/bia-shared/next/supabase/middleware
