import {defineConfig} from 'vitest/config';
import {svelte} from '@sveltejs/vite-plugin-svelte';
export default defineConfig({plugins:[svelte()],build:{assetsInlineLimit:0},test:{include:['src/**/*.test.ts','tests/**/*.unit.test.ts'],coverage:{provider:'v8',thresholds:{statements:100,branches:100,functions:100,lines:100},include:['src/engine/**/*.ts'],exclude:['src/engine/**/*.test.ts']}}});
