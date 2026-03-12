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
    type Pane,
    type SessionState,
    loadSession,
    saveSession,
    createTempFile,
    deleteTempFile,
    generateTabId,
  } from './store';
  import Editor from './Editor.svelte';
  import TabSwitcher from './TabSwitcher.svelte';
  import { loadMonaco, formatDocument, setEditorLanguage, getLanguageDisplayName } from './editor';

  const defaultPaneId = generateTabId();
  let state: SessionState = $state({
    tabs: [],
    panes: [{ id: defaultPaneId, tabIds: [], activeTabId: null }],
    activePaneId: defaultPaneId,
    splitRatio: 0.5,
    nextTempNumber: 1,
    darkMode: localStorage.getItem('darkMode') !== 'false',
    columnSelection: false,
    wordWrap: false,
  });

  let cursorLine = $state(1);
  let cursorCol = $state(1);
  let loaded = $state(false);
  let editors: Record<string, Monaco.editor.IStandaloneCodeEditor> = $state({});
  let editingTabId: string | null = $state(null);

  let updateAvailable: Awaited<ReturnType<typeof check>> | null = $state(null);
  let updateDownloading = $state(false);
  let updateProgress = $state('');
  let updateError = $state('');
  let isDraggingOver = $state(false);
  let isDraggingHandle = $state(false);

  // MRU tab switching state (per-pane)
  let mruOrder: Record<string, string[]> = $state({});
  let switcherOpen = $state(false);
  let switcherIndex = $state(0);

  const activePane = $derived(state.panes.find(p => p.id === state.activePaneId) ?? state.panes[0]);
  const activeTab = $derived(state.tabs.find(t => t.id === activePane?.activeTabId));
  const currentEditor = $derived(editors[state.activePaneId] ?? null);
  const isSplit = $derived(state.panes.length === 2);
  const activeLanguage = $derived(activeTab ? getLanguageDisplayName(activeTab.name) : 'Plain Text');

  function paneTabs(pane: Pane): Tab[] {
    return pane.tabIds.map(id => state.tabs.find(t => t.id === id)!).filter(Boolean);
  }

  // Tabs ordered by MRU for the switcher (scoped to active pane)
  const switcherTabs = $derived.by(() => {
    const paneId = state.activePaneId;
    const order = mruOrder[paneId] ?? [];
    return order
      .map((id) => state.tabs.find((t) => t.id === id))
      .filter((t): t is Tab => t !== undefined);
  });

  // Track active tab in MRU order (only when switcher is closed)
  $effect(() => {
    const paneId = state.activePaneId;
    const pane = state.panes.find(p => p.id === paneId);
    const activeId = pane?.activeTabId;
    const isOpen = switcherOpen;
    if (activeId && !isOpen) {
      const current = untrack(() => mruOrder[paneId] ?? []);
      mruOrder[paneId] = [activeId, ...current.filter((id) => id !== activeId)];
    }
  });

  // Keep MRU in sync with actual tabs per pane (remove stale, add missing)
  $effect(() => {
    for (const pane of state.panes) {
      const tabIds = new Set(pane.tabIds);
      const current = untrack(() => mruOrder[pane.id] ?? []);
      const cleaned = current.filter((id) => tabIds.has(id));
      for (const id of pane.tabIds) {
        if (!cleaned.includes(id)) {
          cleaned.push(id);
        }
      }
      if (cleaned.length !== current.length || cleaned.some((id, i) => id !== current[i])) {
        mruOrder[pane.id] = cleaned;
      }
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
    } else if (activePane && !activePane.activeTabId && activePane.tabIds.length > 0) {
      activePane.activeTabId = activePane.tabIds[0];
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

    // Handle native menu events
    const unlistenCommandPalette = await listen('menu-command-palette', () => {
      openCommandPalette();
    });
    const unlistenWordWrap = await listen('menu-word-wrap', () => {
      toggleWordWrap();
    });
    const unlistenToggleComment = await listen('menu-toggle-comment', () => {
      currentEditor?.focus();
      currentEditor?.trigger('keyboard', 'editor.action.commentLine', null);
    });
    const unlistenNewTab = await listen('menu-new-tab', () => { newTab(); });
    const unlistenOpenFile = await listen('menu-open-file', () => { openFile(); });
    const unlistenSaveFile = await listen('menu-save-file', () => { saveFile(); });
    const unlistenSaveFileAs = await listen('menu-save-file-as', () => { saveFileAs(); });
    const unlistenFormatDocument = await listen('menu-format-document', () => { doFormat(); });
    const unlistenColumnSelection = await listen('menu-column-selection', () => { toggleColumnSelection(); });
    const unlistenToggleTheme = await listen('menu-toggle-theme', () => { toggleTheme(); });
    const unlistenSplitView = await listen('menu-split-view', () => { splitView(); });

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
      unlistenCommandPalette();
      unlistenWordWrap();
      unlistenToggleComment();
      unlistenNewTab();
      unlistenOpenFile();
      unlistenSaveFile();
      unlistenSaveFileAs();
      unlistenFormatDocument();
      unlistenColumnSelection();
      unlistenToggleTheme();
      unlistenSplitView();
      unlisten();
      unlistenDragDrop();
    };
  });

  async function newTab(paneId?: string) {
    const targetPane = state.panes.find(p => p.id === (paneId ?? state.activePaneId)) ?? state.panes[0];
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
    targetPane.tabIds = [...targetPane.tabIds, tab.id];
    targetPane.activeTabId = tab.id;
    state.activePaneId = targetPane.id;
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
      // Check if already open in any pane
      const existing = state.tabs.find((t) => t.path === filePath);
      if (existing) {
        // Focus the pane that contains it
        const ownerPane = state.panes.find(p => p.tabIds.includes(existing.id));
        if (ownerPane) {
          ownerPane.activeTabId = existing.id;
          state.activePaneId = ownerPane.id;
        }
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
        const targetPane = state.panes.find(p => p.id === state.activePaneId) ?? state.panes[0];
        targetPane.tabIds = [...targetPane.tabIds, tab.id];
        targetPane.activeTabId = tab.id;
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

    // Find owning pane
    const pane = state.panes.find(p => p.tabIds.includes(tabId));
    if (!pane) return;

    const index = pane.tabIds.indexOf(tabId);
    pane.tabIds = pane.tabIds.filter(id => id !== tabId);
    state.tabs = state.tabs.filter((t) => t.id !== tabId);

    // Select another tab within this pane
    if (pane.activeTabId === tabId) {
      if (pane.tabIds.length > 0) {
        const newIndex = Math.min(index, pane.tabIds.length - 1);
        pane.activeTabId = pane.tabIds[newIndex];
      } else {
        pane.activeTabId = null;
        await newTab(pane.id);
      }
    }

    await saveSession(state);
  }

  function selectTab(tabId: string, paneId: string) {
    const pane = state.panes.find(p => p.id === paneId);
    if (pane) {
      pane.activeTabId = tabId;
      state.activePaneId = paneId;
    }
  }

  function toggleTheme() {
    state.darkMode = !state.darkMode;
    localStorage.setItem('darkMode', String(state.darkMode));
  }

  function toggleColumnSelection() {
    state.columnSelection = !state.columnSelection;
    for (const ed of Object.values(editors)) {
      ed.updateOptions({ columnSelection: state.columnSelection });
    }
  }

  function toggleWordWrap() {
    state.wordWrap = !state.wordWrap;
    for (const ed of Object.values(editors)) {
      ed.updateOptions({ wordWrap: state.wordWrap ? 'on' : 'off' });
    }
  }

  async function splitView() {
    if (isSplit) {
      // Unsplit: merge pane 2's tabs into pane 1
      const [pane1, pane2] = state.panes;
      pane1.tabIds = [...pane1.tabIds, ...pane2.tabIds];
      if (state.activePaneId === pane2.id && pane2.activeTabId) {
        pane1.activeTabId = pane2.activeTabId;
      }
      // Clean up pane 2's editor reference
      delete editors[pane2.id];
      state.panes = [pane1];
      state.activePaneId = pane1.id;
    } else {
      // Split: create pane 2 with a new empty tab
      const newPaneId = generateTabId();
      state.panes = [...state.panes, { id: newPaneId, tabIds: [], activeTabId: null }];
      state.activePaneId = newPaneId;
      await newTab(newPaneId);
    }
  }

  function startResize(e: PointerEvent) {
    isDraggingHandle = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onResizeMove(e: PointerEvent) {
    if (!isDraggingHandle) return;
    const editorArea = (e.target as HTMLElement).parentElement!;
    const rect = editorArea.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    state.splitRatio = Math.max(0.2, Math.min(0.8, ratio));
  }

  function onResizeEnd() {
    isDraggingHandle = false;
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
    } else if (e.altKey && e.key === 'z') {
      e.preventDefault();
      toggleWordWrap();
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'p') {
      e.preventDefault();
      openCommandPalette();
    } else if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
      e.preventDefault();
      splitView();
    }
  }

  function handleKeyup(e: KeyboardEvent) {
    if (e.key === 'Control' && switcherOpen) {
      const tabs = switcherTabs;
      const selectedTab = tabs[switcherIndex];
      switcherOpen = false;
      switcherIndex = 0;
      if (selectedTab && activePane) {
        activePane.activeTabId = selectedTab.id;
      }
    }
  }

  function doFormat() {
    if (currentEditor) {
      formatDocument(currentEditor);
    }
  }

  function openCommandPalette() {
    currentEditor?.trigger('keyboard', 'editor.action.quickCommand', null);
  }

  async function handleEditorReady(editor: Monaco.editor.IStandaloneCodeEditor, paneId: string) {
    editors[paneId] = editor;

    const pos = editor.getPosition();
    if (paneId === state.activePaneId) {
      cursorLine = pos?.lineNumber ?? 1;
      cursorCol = pos?.column ?? 1;
    }

    editor.onDidChangeCursorPosition((e) => {
      if (paneId === state.activePaneId) {
        cursorLine = e.position.lineNumber;
        cursorCol = e.position.column;
      }
    });

    editor.onDidFocusEditorWidget(() => {
      state.activePaneId = paneId;
    });

    const monaco = await loadMonaco();
    const { KeyMod, KeyCode } = monaco;

    // Cmd+S — save
    editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyS, () => {
      saveFile();
    });

    // Cmd+Shift+S — save as
    editor.addCommand(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyS, () => {
      saveFileAs();
    });

    // Cmd+Shift+C — toggle line comment
    editor.addCommand(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyC, () => {
      editor.trigger('keyboard', 'editor.action.commentLine', null);
    });

    // Alt+Z — word wrap
    editor.addCommand(KeyMod.Alt | KeyCode.KeyZ, () => {
      toggleWordWrap();
    });

    // Cmd+Shift+F — format
    editor.addCommand(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyF, () => {
      doFormat();
    });

    // Cmd+Shift+P — command palette
    editor.addCommand(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyP, () => {
      openCommandPalette();
    });

    // Workaround: backwards (RTL) selections in WKWebView swallow first keypress.
    // Normalize to forward selection before printable character input.
    editor.onKeyDown((e) => {
      const sel = editor.getSelection();
      if (!sel || sel.isEmpty()) return;
      if (sel.getDirection() !== monaco.SelectionDirection.RTL) return;

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const code = e.browserEvent.code;
      if (code.startsWith('Arrow') || /^F\d+$/.test(code)
        || ['Tab', 'Escape', 'Enter', 'Backspace', 'Delete', 'Home', 'End',
            'PageUp', 'PageDown', 'Insert', 'CapsLock', 'NumLock', 'ScrollLock',
            'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
            'MetaLeft', 'MetaRight', 'AltLeft', 'AltRight',
            'ContextMenu', 'PrintScreen', 'Pause'].includes(code)) return;

      editor.setSelection(new monaco.Selection(
        sel.startLineNumber, sel.startColumn,
        sel.endLineNumber, sel.endColumn
      ));
    });
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

  <div class="editor-area" class:dragging={isDraggingHandle}>
    {#each state.panes as pane, paneIndex (pane.id)}
      {@const paneActive = pane.id === state.activePaneId}
      {@const paneTabList = paneTabs(pane)}
      {@const paneActiveTab = state.tabs.find(t => t.id === pane.activeTabId)}
      <div
        class="pane"
        class:active-pane={paneActive}
        style={isSplit ? `width: ${paneIndex === 0 ? state.splitRatio * 100 : (1 - state.splitRatio) * 100}%` : ''}
      >
        <div class="tabs">
          {#each paneTabList as tab (tab.id)}
            <div
              class="tab"
              class:active={tab.id === pane.activeTabId}
              class:dirty={isDirty(tab)}
              class:focused={tab.id === pane.activeTabId && paneActive}
              onclick={() => selectTab(tab.id, pane.id)}
              ondblclick={() => startEditingTab(tab.id)}
              onkeydown={(e) => e.key === 'Enter' && selectTab(tab.id, pane.id)}
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
          <button class="new-tab-btn" onclick={() => newTab(pane.id)} title="New Tab">+</button>
        </div>

        <div class="editor-container">
          {#if loaded && paneActiveTab}
            {#key paneActiveTab.id}
              <Editor
                content={paneActiveTab.content}
                filename={paneActiveTab.name}
                darkMode={state.darkMode}
                columnSelection={state.columnSelection}
                wordWrap={state.wordWrap}
                onUpdate={(content) => { if (paneActiveTab) paneActiveTab.content = content; }}
                onEditorReady={(editor) => handleEditorReady(editor, pane.id)}
              />
            {/key}
          {/if}
        </div>
      </div>
      {#if isSplit && paneIndex === 0}
        <div
          class="resize-handle"
          role="separator"
          onpointerdown={startResize}
          onpointermove={onResizeMove}
          onpointerup={onResizeEnd}
        ></div>
      {/if}
    {/each}
  </div>

  <div class="status-bar">
    <span>Ln {cursorLine}, Col {cursorCol}</span>
    <span class="status-spacer"></span>
    {#if state.wordWrap}<span>Word Wrap</span>{/if}
    {#if state.columnSelection}<span>Column Selection</span>{/if}
    <span>{activeLanguage}</span>
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
    border-bottom-color: #a0a0a0;
  }

  .dark .tab.active {
    background: #1e1e1e;
    border-bottom-color: #555;
  }

  .tab.focused {
    border-bottom-color: #0366d6;
  }

  .dark .tab.focused {
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

  .editor-area {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }

  .editor-area .pane:not(:only-child) {
    flex: none;
  }

  .resize-handle {
    width: 4px;
    cursor: col-resize;
    background: #e1e4e8;
    flex-shrink: 0;
    touch-action: none;
  }

  .dark .resize-handle {
    background: #3c3c3c;
  }

  .resize-handle:hover,
  .editor-area.dragging .resize-handle {
    background: #0366d6;
  }

  .editor-container {
    flex: 1;
    overflow: hidden;
  }

  .status-bar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 2px 12px;
    background: #f6f8fa;
    border-top: 1px solid #e1e4e8;
    font-size: 12px;
    color: #586069;
    user-select: none;
  }

  .dark .status-bar {
    background: #252526;
    border-top-color: #3c3c3c;
    color: #999;
  }

  .status-spacer {
    flex: 1;
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
