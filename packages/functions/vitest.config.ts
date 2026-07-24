import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'functions',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
