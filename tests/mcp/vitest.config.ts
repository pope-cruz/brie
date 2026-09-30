import { defineConfig } from 'vitest/config'

// The MCP integration test needs the local Supabase stack with Edge Functions
// (`supabase start`, or `supabase functions serve` alongside it).
export default defineConfig({
  test: {
    root: '.',
    environment: 'node',
    include: ['tests/mcp/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
