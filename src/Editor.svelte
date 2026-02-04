<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type * as Monaco from 'monaco-editor';
  import { createEditor, setupThemes, setEditorTheme } from './editor';

  let {
    content,
    filename,
    darkMode,
    onUpdate,
    onEditorReady,
  }: {
    content: string;
    filename: string;
    darkMode: boolean;
    onUpdate: (content: string) => void;
    onEditorReady?: (editor: Monaco.editor.IStandaloneCodeEditor) => void;
  } = $props();

  let container: HTMLDivElement;
  let editor: Monaco.editor.IStandaloneCodeEditor | null = null;

  onMount(() => {
    setupThemes();
    editor = createEditor(container, content, filename, darkMode, onUpdate);
    
    if (onEditorReady) {
      onEditorReady(editor);
    }

    // Focus editor
    editor.focus();
  });

  onDestroy(() => {
    editor?.dispose();
  });

  // React to theme changes
  $effect(() => {
    if (editor) {
      setEditorTheme(darkMode);
    }
  });
</script>

<div class="editor" bind:this={container}></div>

<style>
  .editor {
    width: 100%;
    height: 100%;
  }
</style>
