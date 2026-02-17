import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import monacoEditor from 'vite-plugin-monaco-editor';

const monacoPlugin = (monacoEditor as any).default as typeof monacoEditor;

export default defineConfig({
  plugins: [
    svelte(),
    monacoPlugin({
      languageWorkers: ['editorWorkerService', 'json', 'typescript', 'html', 'css'],
    }),
  ],
  clearScreen: false,
  server: {
    port: 6173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
});
