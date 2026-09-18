/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/rally/',
  plugins: [react()],
  test: {
    // Scope tests to the frontend src/ only. The Deno *.test.ts files under
    // supabase/functions use a different runtime and must not be picked up.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'supabase/**'],
    environment: 'jsdom',
    globals: true,
  },
})
