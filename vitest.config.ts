import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['packages/**/*.test.ts','apps/**/*.unit.test.ts','apps/**/*.test.tsx'],environment:'node'}});
