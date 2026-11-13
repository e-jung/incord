import {defineConfig} from 'vitest/config';
import {execFileSync} from 'node:child_process';
import {svelte} from '@sveltejs/vite-plugin-svelte';
export default defineConfig({plugins:[svelte()],define:{'import.meta.env.VITE_APP_VERSION':JSON.stringify(execFileSync('git',['rev-parse','--short','HEAD']).toString().trim())},build:{assetsInlineLimit:0,rollupOptions:{input:{app:'index.html',stats:'src/stats.css'},output:{assetFileNames:asset=>asset.names.includes('stats.css')?'assets/stats.css':'assets/[name]-[hash][extname]'}}},test:{include:['src/**/*.test.ts','tests/**/*.unit.test.ts'],coverage:{provider:'v8',thresholds:{statements:100,branches:100,functions:100,lines:100},include:['src/engine/**/*.ts'],exclude:['src/engine/**/*.test.ts']}}});
