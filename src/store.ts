import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile, remove, rename } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';

export interface Tab {
  id: string;
  name: string;
  path: string | null; // null = temp file
  tempPath: string | null; // path to temp file in app data
  content: string;
  savedContent: string; // to track dirty state
  cursorPos: number;
}

export interface Pane {
  id: string;
  tabIds: string[];
  activeTabId: string | null;
}

export interface SessionState {
  tabs: Tab[];
  panes: Pane[];
  activePaneId: string;
  splitRatio: number;
  nextTempNumber: number;
  darkMode: boolean;
  columnSelection: boolean;
  wordWrap: boolean;
}

const SESSION_FILE = 'session.json';
const TEMP_DIR = 'temp';

export async function ensureTempDir(): Promise<string> {
  const appData = await appDataDir();
  const tempPath = await join(appData, TEMP_DIR);
  
  if (!(await exists(tempPath))) {
    await mkdir(tempPath, { recursive: true });
  }
  
  return tempPath;
}

export async function loadSession(): Promise<SessionState> {
  try {
    const appData = await appDataDir();
    const sessionPath = await join(appData, SESSION_FILE);
    
    if (await exists(sessionPath)) {
      const content = await readTextFile(sessionPath);
      const session = JSON.parse(content) as any;

      // Migrate old sessions without panes
      if (!session.panes) {
        const paneId = generateTabId();
        session.panes = [{
          id: paneId,
          tabIds: session.tabs.map((t: Tab) => t.id),
          activeTabId: session.activeTabId ?? null,
        }];
        session.activePaneId = paneId;
        session.splitRatio = 0.5;
        delete session.activeTabId;
      }

      // Load content for tabs in parallel
      await Promise.all(session.tabs.map(async (tab: Tab) => {
        const pathToRead = tab.tempPath || tab.path;
        if (pathToRead) {
          try {
            tab.content = await readTextFile(pathToRead);
            tab.savedContent = tab.content;
          } catch (e) {
            console.warn(`Could not load file for tab "${tab.name}":`, e);
            tab.content = '';
            tab.savedContent = '';
          }
        }
      }));

      return session as SessionState;
    }
  } catch (e) {
    console.error('Failed to load session:', e);
  }
  
  const paneId = generateTabId();
  return {
    tabs: [],
    panes: [{ id: paneId, tabIds: [], activeTabId: null }],
    activePaneId: paneId,
    splitRatio: 0.5,
    nextTempNumber: 1,
    darkMode: true,
    columnSelection: false,
    wordWrap: false,
  };
}

export async function saveSession(state: SessionState): Promise<void> {
  try {
    const appData = await appDataDir();
    
    // Ensure app data dir exists
    if (!(await exists(appData))) {
      await mkdir(appData, { recursive: true });
    }
    
    const sessionPath = await join(appData, SESSION_FILE);
    
    // Save temp file contents in parallel
    await ensureTempDir();
    await Promise.all(
      state.tabs
        .filter((t) => t.tempPath)
        .map((t) => writeTextFile(t.tempPath!, t.content)),
    );
    
    // Save session (without content to keep it small)
    const sessionToSave = {
      ...state,
      tabs: state.tabs.map(t => ({
        ...t,
        content: '',
        savedContent: '',
      })),
    };
    
    // Write atomically: write to a temp file, then rename into place so a
    // crash mid-write can never leave a truncated/corrupt session.json
    // (which would parse-fail on next launch and discard every tab).
    const tempSessionPath = sessionPath + '.tmp';
    await writeTextFile(tempSessionPath, JSON.stringify(sessionToSave, null, 2));
    await rename(tempSessionPath, sessionPath);
  } catch (e) {
    console.error('Failed to save session:', e);
  }
}

export async function createTempFile(number: number): Promise<string> {
  const tempDir = await ensureTempDir();
  return await join(tempDir, `new ${number}.txt`);
}

export async function deleteTempFile(path: string): Promise<void> {
  try {
    if (await exists(path)) {
      await remove(path);
    }
  } catch (e) {
    console.error('Failed to delete temp file:', e);
  }
}

export function generateTabId(): string {
  return Math.random().toString(36).substring(2, 9);
}
