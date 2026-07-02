// Vitest stub for the `server-only` marker package: in a plain Node test run
// there is no client/server bundle split, so the real package (which throws
// outside a React Server environment) must resolve to a no-op. Wired up via
// resolve.alias in vitest.config.ts.
export {};
