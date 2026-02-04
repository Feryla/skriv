import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile, remove } from '@tauri-apps/plugin-fs';
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

export interface SessionState {
  tabs: Tab[];
  activeTabId: string | null;
  nextTempNumber: number;
  darkMode: boolean;
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
      const session = JSON.parse(content) as SessionState;
      
      // Load content for temp files
      for (const tab of session.tabs) {
        if (tab.tempPath) {
          try {
            if (await exists(tab.tempPath)) {
              tab.content = await readTextFile(tab.tempPath);
              tab.savedContent = tab.content;
            }
          } catch {
            tab.content = '';
            tab.savedContent = '';
          }
        } else if (tab.path) {
          try {
            if (await exists(tab.path)) {
              tab.content = await readTextFile(tab.path);
              tab.savedContent = tab.content;
            }
          } catch {
            tab.content = '';
            tab.savedContent = '';
          }
        }
      }
      
      return session;
    }
  } catch (e) {
    console.error('Failed to load session:', e);
  }
  
  return {
    tabs: [],
    activeTabId: null,
    nextTempNumber: 1,
    darkMode: true,
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
    
    // Save temp file contents
    const tempDir = await ensureTempDir();
    for (const tab of state.tabs) {
      if (tab.tempPath) {
        await writeTextFile(tab.tempPath, tab.content);
      }
    }
    
    // Save session (without content to keep it small)
    const sessionToSave = {
      ...state,
      tabs: state.tabs.map(t => ({
        ...t,
        content: '',
        savedContent: '',
      })),
    };
    
    await writeTextFile(sessionPath, JSON.stringify(sessionToSave, null, 2));
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
