import {defineConfig} from 'vitest/config';
import {svelte} from '@sveltejs/vite-plugin-svelte';
export default defineConfig({plugins:[svelte()],test:{include:['src/**/*.test.ts'],coverage:{provider:'v8',include:['src/engine/**/*.ts'],exclude:['src/engine/**/*.test.ts']}}});
