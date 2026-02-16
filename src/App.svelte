<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { listen } from '@tauri-apps/api/event';
  import { invoke } from '@tauri-apps/api/core';
  import { open, save } from '@tauri-apps/plugin-dialog';
  import { readTextFile, writeTextFile, rename } from '@tauri-apps/plugin-fs';
  import { check } from '@tauri-apps/plugin-updater';
  import { relaunch } from '@tauri-apps/plugin-process';
  import type * as Monaco from 'monaco-editor';
  import {
    type Tab,
    type SessionState,
    loadSession,
    saveSession,
    createTempFile,
    deleteTempFile,
    generateTabId,
  } from './store';
  import Editor from './Editor.svelte';
  import TabSwitcher from './TabSwitcher.svelte';
  import { formatDocument, setEditorLanguage } from './editor';

  let state: SessionState = $state({
    tabs: [],
    activeTabId: null,
    nextTempNumber: 1,
    darkMode: localStorage.getItem('darkMode') !== 'false',
    columnSelection: false,
  });

  let loaded = $state(false);
  let currentEditor: Monaco.editor.IStandaloneCodeEditor | null = $state(null);
  let editingTabId: string | null = $state(null);

  let updateAvailable: Awaited<ReturnType<typeof check>> | null = $state(null);
  let updateDownloading = $state(false);
  let updateProgress = $state('');
  let updateError = $state('');
  let isDraggingOver = $state(false);

  // MRU tab switching state
  let mruOrder: string[] = $state([]);
  let switcherOpen = $state(false);
  let switcherIndex = $state(0);

  const activeTab = $derived(state.tabs.find((t) => t.id === state.activeTabId));

  // Tabs ordered by MRU for the switcher
  const switcherTabs = $derived(
    mruOrder
      .map((id) => state.tabs.find((t) => t.id === id))
      .filter((t): t is Tab => t !== undefined),
  );

  // Track active tab in MRU order (only when switcher is closed)
  $effect(() => {
    const activeId = state.activeTabId;
    const isOpen = switcherOpen;
    if (activeId && !isOpen) {
      const current = untrack(() => mruOrder);
      mruOrder = [activeId, ...current.filter((id) => id !== activeId)];
    }
  });

  // Keep MRU in sync with actual tabs (remove stale, add missing)
  $effect(() => {
    const tabIds = new Set(state.tabs.map((t) => t.id));
    const current = untrack(() => mruOrder);
    const cleaned = current.filter((id) => tabIds.has(id));
    for (const tab of state.tabs) {
      if (!cleaned.includes(tab.id)) {
        cleaned.push(tab.id);
      }
    }
    if (cleaned.length !== current.length || cleaned.some((id, i) => id !== current[i])) {
      mruOrder = cleaned;
    }
  });

  $effect(() => {
    const title = activeTab
      ? `${activeTab.path ?? activeTab.name} - skriv`
      : 'skriv';
    getCurrentWindow().setTitle(title);
  });

  // Debounced auto-save: saves 1s after any state change
  $effect(() => {
    // Read reactive state to establish dependency tracking
    const _ = JSON.stringify(state);
    if (!loaded) return;
    const timeout = setTimeout(() => saveSession(state), 500);
    return () => clearTimeout(timeout);
  });

  onMount(async () => {
    state = await loadSession();

    // If no tabs, create a new one
    if (state.tabs.length === 0) {
      await newTab();
    } else if (!state.activeTabId && state.tabs.length > 0) {
      state.activeTabId = state.tabs[0].id;
    }

    loaded = true;
    localStorage.setItem('darkMode', String(state.darkMode));

    // Handle CLI args from first launch
    const [args, cwd] = await invoke<[string[], string]>('get_cli_args');
    const cliPaths = resolveCliPaths(args, cwd);
    if (cliPaths.length > 0) {
      await openFilePaths(cliPaths);
    }

    // Handle files from second instance (single-instance plugin)
    const unlistenOpenFiles = await listen<[string[], string]>('open-files', async (event) => {
      const [secondArgs, secondCwd] = event.payload;
      const paths = resolveCliPaths(secondArgs, secondCwd);
      if (paths.length > 0) {
        await openFilePaths(paths);
      }
    });

    // Check for updates (fire-and-forget)
    checkForUpdates();

    // Save on close - use Tauri's event which properly awaits async operations
    const unlisten = await getCurrentWindow().onCloseRequested(async () => {
      await saveSession(state);
    });

    // Handle drag-and-drop files
    const unlistenDragDrop = await getCurrentWindow().onDragDropEvent(async (event) => {
      if (event.payload.type === 'over') {
        isDraggingOver = true;
      } else if (event.payload.type === 'leave' || event.payload.type === 'cancel') {
        isDraggingOver = false;
      } else if (event.payload.type === 'drop') {
        isDraggingOver = false;
        const paths = event.payload.paths;
        await openFilePaths(paths);
      }
    });

    return () => {
      unlistenOpenFiles();
      unlisten();
      unlistenDragDrop();
    };
  });

  async function newTab() {
    const tempPath = await createTempFile(state.nextTempNumber);
    const tab: Tab = {
      id: generateTabId(),
      name: `new ${state.nextTempNumber}.txt`,
      path: null,
      tempPath,
      content: '',
      savedContent: '',
      cursorPos: 0,
    };

    state.tabs = [...state.tabs, tab];
    state.activeTabId = tab.id;
    state.nextTempNumber++;
  }

  async function openFile() {
    const selected = await open({
      multiple: true,
    });

    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      await openFilePaths(paths);
    }
  }

  async function openFilePaths(paths: string[]) {
    for (const filePath of paths) {
      // Check if already open
      const existing = state.tabs.find((t) => t.path === filePath);
      if (existing) {
        state.activeTabId = existing.id;
        continue;
      }

      try {
        const content = await readTextFile(filePath);
        const name = filePath.split(/[/\\]/).pop() || 'untitled';

        const tab: Tab = {
          id: generateTabId(),
          name,
          path: filePath,
          tempPath: null,
          content,
          savedContent: content,
          cursorPos: 0,
        };

        state.tabs = [...state.tabs, tab];
        state.activeTabId = tab.id;
      } catch (e) {
        // Skip files that can't be read (e.g., directories, binary files)
        console.error(`Failed to open ${filePath}:`, e);
      }
    }
  }

  function resolveCliPaths(args: string[], cwd: string): string[] {
    return args
      .slice(1) // skip binary path
      .filter((a) => !a.startsWith('-'))
      .map((p) => (p.startsWith('/') ? p : cwd + '/' + p));
  }

  async function saveFile() {
    if (!activeTab) return;

    if (activeTab.path) {
      // Save to existing file
      await writeTextFile(activeTab.path, activeTab.content);
      activeTab.savedContent = activeTab.content;
      state.tabs = [...state.tabs]; // trigger reactivity
    } else {
      // Save as new file
      await saveFileAs();
    }
  }

  async function saveFileAs() {
    if (!activeTab) return;

    const filePath = await save({
      defaultPath: activeTab.name,
    });

    if (filePath) {
      await writeTextFile(filePath, activeTab.content);

      // Delete temp file if it exists
      if (activeTab.tempPath) {
        await deleteTempFile(activeTab.tempPath);
      }

      activeTab.path = filePath;
      activeTab.tempPath = null;
      activeTab.name = filePath.split(/[/\\]/).pop() || 'untitled';
      activeTab.savedContent = activeTab.content;
      if (currentEditor) {
        setEditorLanguage(currentEditor, activeTab.name);
      }
      state.tabs = [...state.tabs];
    }
  }

  async function closeTab(tabId: string) {
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Delete temp file
    if (tab.tempPath) {
      await deleteTempFile(tab.tempPath);
    }

    const index = state.tabs.findIndex((t) => t.id === tabId);
    state.tabs = state.tabs.filter((t) => t.id !== tabId);

    // Select another tab
    if (state.activeTabId === tabId) {
      if (state.tabs.length > 0) {
        const newIndex = Math.min(index, state.tabs.length - 1);
        state.activeTabId = state.tabs[newIndex].id;
      } else {
        state.activeTabId = null;
        await newTab();
      }
    }

    await saveSession(state);
  }

  function selectTab(tabId: string) {
    state.activeTabId = tabId;
  }

  function updateContent(content: string) {
    if (activeTab) {
      activeTab.content = content;
    }
  }

  function toggleTheme() {
    state.darkMode = !state.darkMode;
    localStorage.setItem('darkMode', String(state.darkMode));
  }

  function toggleColumnSelection() {
    state.columnSelection = !state.columnSelection;
    currentEditor?.updateOptions({ columnSelection: state.columnSelection });
  }

  function isDirty(tab: Tab): boolean {
    return tab.content !== tab.savedContent;
  }

  async function checkForUpdates() {
    try {
      const update = await check();
      if (update) {
        updateAvailable = update;
      }
    } catch (e) {
      console.error('Failed to check for updates:', e);
    }
  }

  async function installUpdate() {
    if (!updateAvailable) return;
    updateDownloading = true;
    try {
      let downloaded = 0;
      let total = 0;
      await updateAvailable.downloadAndInstall((event) => {
        if (event.event === 'Started' && event.data.contentLength) {
          total = event.data.contentLength;
          updateProgress = '0%';
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (total > 0) {
            updateProgress = `${Math.round((downloaded / total) * 100)}%`;
          }
        } else if (event.event === 'Finished') {
          updateProgress = 'Done';
        }
      });
      await relaunch();
    } catch (e) {
      console.error('Failed to install update:', e);
      updateDownloading = false;
      updateProgress = '';
      updateError = String(e);
    }
  }

  function dismissUpdate() {
    updateAvailable = null;
  }

  function handleKeydown(e: KeyboardEvent) {
    // Tab switcher: Ctrl+Tab / Ctrl+Shift+Tab
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      const tabs = switcherTabs;
      if (tabs.length < 2) return;

      if (!switcherOpen) {
        switcherOpen = true;
        switcherIndex = e.shiftKey ? tabs.length - 1 : 1;
      } else {
        if (e.shiftKey) {
          switcherIndex = (switcherIndex - 1 + tabs.length) % tabs.length;
        } else {
          switcherIndex = (switcherIndex + 1) % tabs.length;
        }
      }
      return;
    }

    // Close switcher on Escape without switching
    if (switcherOpen && e.key === 'Escape') {
      e.preventDefault();
      switcherOpen = false;
      switcherIndex = 0;
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveFile();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
      e.preventDefault();
      openFile();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 't')) {
      e.preventDefault();
      newTab();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
      e.preventDefault();
      if (activeTab) closeTab(activeTab.id);
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      doFormat();
    }
  }

  function handleKeyup(e: KeyboardEvent) {
    if (e.key === 'Control' && switcherOpen) {
      const tabs = switcherTabs;
      const selectedTab = tabs[switcherIndex];
      switcherOpen = false;
      switcherIndex = 0;
      if (selectedTab) {
        state.activeTabId = selectedTab.id;
      }
    }
  }

  function doFormat() {
    if (currentEditor) {
      formatDocument(currentEditor);
    }
  }

  function handleEditorReady(editor: Monaco.editor.IStandaloneCodeEditor) {
    currentEditor = editor;
  }

  async function renameTab(tabId: string, newName: string) {
    editingTabId = null;
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const trimmed = newName.trim();
    if (!trimmed || trimmed === tab.name) return;

    if (tab.path) {
      const dir = tab.path.replace(/[/\\][^/\\]*$/, '');
      const newPath = dir + '/' + trimmed;
      await rename(tab.path, newPath);
      tab.path = newPath;
    }

    tab.name = trimmed;
    if (currentEditor) {
      setEditorLanguage(currentEditor, tab.name);
    }
    state.tabs = [...state.tabs];
  }

  function startEditingTab(tabId: string) {
    editingTabId = tabId;
  }

  function handleRenameKeydown(e: KeyboardEvent, tabId: string) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const input = e.target as HTMLInputElement;
      renameTab(tabId, input.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editingTabId = null;
    }
  }

  function handleRenameBlur(e: FocusEvent, tabId: string) {
    if (editingTabId === tabId) {
      const input = e.target as HTMLInputElement;
      renameTab(tabId, input.value);
    }
  }

  function focusAndSelectRenameInput(node: HTMLInputElement) {
    node.focus();
    const name = node.value;
    const dotIndex = name.lastIndexOf('.');
    if (dotIndex > 0) {
      node.setSelectionRange(0, dotIndex);
    } else {
      node.select();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} on:keyup={handleKeyup} />

<div class="app" class:dark={state.darkMode} class:drag-over={isDraggingOver}>
  <div class="toolbar">
    <button onclick={newTab} title="New (Ctrl+N)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
    <button onclick={openFile} title="Open (Ctrl+O)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
    </button>
    <button onclick={saveFile} title="Save (Ctrl+S)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
        <polyline points="17 21 17 13 7 13 7 21" />
        <polyline points="7 3 7 8 15 8" />
      </svg>
    </button>
    <button onclick={saveFileAs} title="Save As">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
        <path d="M12 11v6M9 14h6" />
      </svg>
    </button>
    <div class="separator"></div>
    <button onclick={doFormat} title="Format Document (Ctrl+Shift+F)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 6h16M4 12h10M4 18h14" />
      </svg>
    </button>
    <button class:active={state.columnSelection} onclick={toggleColumnSelection} title="Column Selection">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="6" y="4" width="12" height="16" rx="1" />
        <rect x="9" y="7" width="6" height="6" rx="0.5" opacity="0.5" fill="currentColor" stroke="none" />
      </svg>
    </button>
    <div class="spacer"></div>
    <button onclick={toggleTheme} title="Toggle Theme">
      {#if state.darkMode}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="5" />
          <path
            d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
          />
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      {/if}
    </button>
  </div>

  {#if updateError}
    <div class="update-bar" style="background: #d32f2f;">
      <span>Update failed: {updateError}</span>
      <button class="update-dismiss-btn" onclick={() => updateError = ''}>Dismiss</button>
    </div>
  {:else if updateAvailable}
    <div class="update-bar">
      {#if updateDownloading}
        <span>Downloading update... {updateProgress}</span>
      {:else}
        <span>Update {updateAvailable.version} available</span>
        <button class="update-btn" onclick={installUpdate}>Update now</button>
        <button class="update-dismiss-btn" onclick={dismissUpdate}>Dismiss</button>
      {/if}
    </div>
  {/if}

  <div class="tabs">
    {#each state.tabs as tab (tab.id)}
      <div
        class="tab"
        class:active={tab.id === state.activeTabId}
        class:dirty={isDirty(tab)}
        onclick={() => selectTab(tab.id)}
        ondblclick={() => startEditingTab(tab.id)}
        onkeydown={(e) => e.key === 'Enter' && selectTab(tab.id)}
        role="tab"
        tabindex="0"
      >
        {#if editingTabId === tab.id}
          <input
            class="tab-name-input"
            value={tab.name}
            onkeydown={(e) => handleRenameKeydown(e, tab.id)}
            onblur={(e) => handleRenameBlur(e, tab.id)}
            onclick={(e) => e.stopPropagation()}
            use:focusAndSelectRenameInput
          />
        {:else}
          <span class="tab-name">{tab.name}</span>
        {/if}
        {#if isDirty(tab)}
          <span class="dirty-indicator">●</span>
        {/if}
        <button
          class="close-btn"
          onclick={(e) => {
            e.stopPropagation();
            closeTab(tab.id);
          }}
          title="Close"
        >
          ×
        </button>
      </div>
    {/each}
    <button class="new-tab-btn" onclick={newTab} title="New Tab">+</button>
  </div>

  <div class="editor-container">
    {#if loaded && activeTab}
      {#key activeTab.id}
        <Editor
          content={activeTab.content}
          filename={activeTab.name}
          darkMode={state.darkMode}
          columnSelection={state.columnSelection}
          onUpdate={updateContent}
          onEditorReady={handleEditorReady}
        />
      {/key}
    {/if}
  </div>

  {#if switcherOpen}
    <TabSwitcher tabs={switcherTabs} selectedIndex={switcherIndex} darkMode={state.darkMode} />
  {/if}
</div>

<style>
  :global(*) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  :global(body) {
    overflow: hidden;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #ffffff;
    color: #24292e;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  }

  .app.dark {
    background: #1e1e1e;
    color: #d4d4d4;
  }

  .toolbar {
    display: flex;
    gap: 4px;
    padding: 8px;
    background: #f6f8fa;
    border-bottom: 1px solid #e1e4e8;
  }

  .dark .toolbar {
    background: #252526;
    border-bottom-color: #3c3c3c;
  }

  .toolbar button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    background: transparent;
    color: inherit;
    border-radius: 4px;
    cursor: pointer;
  }

  .toolbar button:hover {
    background: #e1e4e8;
  }

  .dark .toolbar button:hover {
    background: #3c3c3c;
  }

  .toolbar button.active {
    background: #0366d6;
    color: #fff;
  }

  .toolbar button.active:hover {
    background: #0255b3;
  }

  .toolbar svg {
    width: 18px;
    height: 18px;
  }

  .spacer {
    flex: 1;
  }

  .separator {
    width: 1px;
    height: 20px;
    background: #e1e4e8;
    margin: 6px 4px;
  }

  .dark .separator {
    background: #3c3c3c;
  }

  .tabs {
    display: flex;
    background: #f6f8fa;
    border-bottom: 1px solid #e1e4e8;
    overflow-x: auto;
  }

  .dark .tabs {
    background: #252526;
    border-bottom-color: #3c3c3c;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    font-size: 13px;
    white-space: nowrap;
  }

  .tab:hover {
    background: #e1e4e8;
  }

  .dark .tab:hover {
    background: #2d2d2d;
  }

  .tab.active {
    background: #ffffff;
    border-bottom-color: #0366d6;
  }

  .dark .tab.active {
    background: #1e1e1e;
    border-bottom-color: #0366d6;
  }

  .tab-name {
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-name-input {
    max-width: 150px;
    font-size: 13px;
    font-family: inherit;
    background: transparent;
    color: inherit;
    border: 1px solid #0366d6;
    border-radius: 2px;
    padding: 0 2px;
    outline: none;
  }

  .dirty-indicator {
    color: #f97316;
    font-size: 10px;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    background: transparent;
    color: inherit;
    border-radius: 3px;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    opacity: 0.6;
  }

  .close-btn:hover {
    opacity: 1;
    background: #d73a49;
    color: white;
  }

  .new-tab-btn {
    padding: 8px 12px;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 18px;
    opacity: 0.6;
  }

  .new-tab-btn:hover {
    opacity: 1;
  }

  .update-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: #0366d6;
    color: #fff;
    font-size: 13px;
  }

  .update-btn {
    padding: 2px 10px;
    border: 1px solid #fff;
    background: transparent;
    color: #fff;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
  }

  .update-btn:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .update-dismiss-btn {
    padding: 2px 10px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    font-size: 12px;
  }

  .update-dismiss-btn:hover {
    color: #fff;
  }

  .editor-container {
    flex: 1;
    overflow: hidden;
  }

  .app.drag-over::after {
    content: '';
    position: fixed;
    inset: 0;
    background: rgba(3, 102, 214, 0.1);
    border: 3px dashed #0366d6;
    pointer-events: none;
    z-index: 1000;
  }
</style>
