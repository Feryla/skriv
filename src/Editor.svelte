<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type * as Monaco from 'monaco-editor';
  import type { Tab } from './store';
  import {
    loadMonaco,
    createEditor,
    setupThemes,
    setEditorTheme,
    getTabModel,
    saveTabViewState,
    restoreTabViewState,
  } from './editor';

  let {
    tab,
    darkMode,
    columnSelection,
    wordWrap,
    onUpdate,
    onEditorReady,
  }: {
    tab: Tab;
    darkMode: boolean;
    columnSelection: boolean;
    wordWrap: boolean;
    onUpdate: (tabId: string, content: string) => void;
    onEditorReady?: (editor: Monaco.editor.IStandaloneCodeEditor) => void;
  } = $props();

  let container: HTMLDivElement;
  let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
  let currentTabId: string | null = null;

  // Attach the given tab's model, preserving the outgoing tab's view state.
  function showTab(t: Tab) {
    if (!editor || currentTabId === t.id) return;
    if (currentTabId) saveTabViewState(currentTabId, editor);
    const model = getTabModel(t.id, t.content, t.name, (content) => onUpdate(t.id, content));
    editor.setModel(model);
    restoreTabViewState(t.id, editor);
    currentTabId = t.id;
    editor.focus();
  }

  onMount(async () => {
    await loadMonaco();
    setupThemes();
    editor = createEditor(container, darkMode, columnSelection, wordWrap);
    showTab(tab);

    if (onEditorReady) {
      onEditorReady(editor);
    }
  });

  // Swap models when the active tab changes (no editor recreation).
  $effect(() => {
    const t = tab;
    if (editor && t) showTab(t);
  });

  onDestroy(() => {
    if (editor && currentTabId) saveTabViewState(currentTabId, editor);
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
