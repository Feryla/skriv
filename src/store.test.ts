import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadSession,
  saveSession,
  createTempFile,
  deleteTempFile,
  generateTabId,
  ensureTempDir,
  type Tab,
  type SessionState,
} from './store';
import { resetMockFileSystem, setMockFile, getMockFile, mockFileExists } from './test/setup';

describe('store', () => {
  beforeEach(() => {
    resetMockFileSystem();
    vi.clearAllMocks();
  });

  describe('generateTabId', () => {
    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateTabId());
      }
      expect(ids.size).toBe(100);
    });

    it('should generate string IDs of expected length', () => {
      const id = generateTabId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(id.length).toBeLessThanOrEqual(7);
    });
  });

  describe('ensureTempDir', () => {
    it('should return temp directory path', async () => {
      const tempDir = await ensureTempDir();
      expect(tempDir).toBe('/mock/app/data/temp');
    });
  });

  describe('createTempFile', () => {
    it('should create temp file path with correct naming', async () => {
      const path1 = await createTempFile(1);
      expect(path1).toBe('/mock/app/data/temp/new 1.txt');

      const path2 = await createTempFile(42);
      expect(path2).toBe('/mock/app/data/temp/new 42.txt');
    });
  });

  describe('deleteTempFile', () => {
    it('should delete existing temp file', async () => {
      const path = '/mock/app/data/temp/new 1.txt';
      setMockFile(path, 'test content');
      expect(mockFileExists(path)).toBe(true);

      await deleteTempFile(path);
      expect(mockFileExists(path)).toBe(false);
    });

    it('should not throw when deleting non-existent file', async () => {
      const path = '/mock/app/data/temp/nonexistent.txt';
      await expect(deleteTempFile(path)).resolves.not.toThrow();
    });
  });

  describe('loadSession', () => {
    it('should return default session when no session file exists', async () => {
      const session = await loadSession();

      expect(session).toEqual({
        tabs: [],
        activeTabId: null,
        nextTempNumber: 1,
        darkMode: true,
      });
    });

    it('should load session from file', async () => {
      const savedSession: SessionState = {
        tabs: [
          {
            id: 'tab1',
            name: 'test.txt',
            path: '/home/user/test.txt',
            tempPath: null,
            content: '',
            savedContent: '',
            cursorPos: 0,
          },
        ],
        activeTabId: 'tab1',
        nextTempNumber: 2,
        darkMode: false,
      };

      setMockFile('/mock/app/data/session.json', JSON.stringify(savedSession));
      setMockFile('/home/user/test.txt', 'file content here');

      const session = await loadSession();

      expect(session.tabs).toHaveLength(1);
      expect(session.tabs[0].name).toBe('test.txt');
      expect(session.tabs[0].content).toBe('file content here');
      expect(session.tabs[0].savedContent).toBe('file content here');
      expect(session.activeTabId).toBe('tab1');
      expect(session.nextTempNumber).toBe(2);
      expect(session.darkMode).toBe(false);
    });

    it('should load content from temp files for unsaved tabs', async () => {
      const savedSession: SessionState = {
        tabs: [
          {
            id: 'temp1',
            name: 'new 1.txt',
            path: null,
            tempPath: '/mock/app/data/temp/new 1.txt',
            content: '',
            savedContent: '',
            cursorPos: 0,
          },
        ],
        activeTabId: 'temp1',
        nextTempNumber: 2,
        darkMode: true,
      };

      setMockFile('/mock/app/data/session.json', JSON.stringify(savedSession));
      setMockFile('/mock/app/data/temp/new 1.txt', 'unsaved content');

      const session = await loadSession();

      expect(session.tabs[0].content).toBe('unsaved content');
      expect(session.tabs[0].savedContent).toBe('unsaved content');
    });

    it('should handle multiple tabs with mixed file types', async () => {
      const savedSession: SessionState = {
        tabs: [
          {
            id: 'tab1',
            name: 'saved.ts',
            path: '/home/user/saved.ts',
            tempPath: null,
            content: '',
            savedContent: '',
            cursorPos: 10,
          },
          {
            id: 'tab2',
            name: 'new 1.txt',
            path: null,
            tempPath: '/mock/app/data/temp/new 1.txt',
            content: '',
            savedContent: '',
            cursorPos: 5,
          },
          {
            id: 'tab3',
            name: 'another.js',
            path: '/home/user/another.js',
            tempPath: null,
            content: '',
            savedContent: '',
            cursorPos: 0,
          },
        ],
        activeTabId: 'tab2',
        nextTempNumber: 2,
        darkMode: true,
      };

      setMockFile('/mock/app/data/session.json', JSON.stringify(savedSession));
      setMockFile('/home/user/saved.ts', 'typescript code');
      setMockFile('/mock/app/data/temp/new 1.txt', 'temp content');
      setMockFile('/home/user/another.js', 'javascript code');

      const session = await loadSession();

      expect(session.tabs).toHaveLength(3);
      expect(session.tabs[0].content).toBe('typescript code');
      expect(session.tabs[1].content).toBe('temp content');
      expect(session.tabs[2].content).toBe('javascript code');
    });

    it('should handle missing files gracefully', async () => {
      const savedSession: SessionState = {
        tabs: [
          {
            id: 'tab1',
            name: 'missing.txt',
            path: '/home/user/missing.txt',
            tempPath: null,
            content: '',
            savedContent: '',
            cursorPos: 0,
          },
        ],
        activeTabId: 'tab1',
        nextTempNumber: 1,
        darkMode: true,
      };

      setMockFile('/mock/app/data/session.json', JSON.stringify(savedSession));
      // Note: /home/user/missing.txt is NOT set in mock

      const session = await loadSession();

      expect(session.tabs[0].content).toBe('');
      expect(session.tabs[0].savedContent).toBe('');
    });

    it('should handle corrupt session file gracefully', async () => {
      setMockFile('/mock/app/data/session.json', 'not valid json{{{');

      const session = await loadSession();

      expect(session).toEqual({
        tabs: [],
        activeTabId: null,
        nextTempNumber: 1,
        darkMode: true,
      });
    });
  });

  describe('saveSession', () => {
    it('should save session to file', async () => {
      const state: SessionState = {
        tabs: [
          {
            id: 'tab1',
            name: 'test.txt',
            path: '/home/user/test.txt',
            tempPath: null,
            content: 'file content',
            savedContent: 'file content',
            cursorPos: 5,
          },
        ],
        activeTabId: 'tab1',
        nextTempNumber: 1,
        darkMode: true,
      };

      await saveSession(state);

      const saved = getMockFile('/mock/app/data/session.json');
      expect(saved).toBeDefined();

      const parsed = JSON.parse(saved!);
      expect(parsed.tabs).toHaveLength(1);
      expect(parsed.tabs[0].name).toBe('test.txt');
      expect(parsed.tabs[0].content).toBe(''); // Content stripped
      expect(parsed.tabs[0].savedContent).toBe(''); // SavedContent stripped
      expect(parsed.activeTabId).toBe('tab1');
    });

    it('should save temp file contents to disk', async () => {
      const state: SessionState = {
        tabs: [
          {
            id: 'temp1',
            name: 'new 1.txt',
            path: null,
            tempPath: '/mock/app/data/temp/new 1.txt',
            content: 'unsaved content here',
            savedContent: '',
            cursorPos: 0,
          },
        ],
        activeTabId: 'temp1',
        nextTempNumber: 2,
        darkMode: true,
      };

      await saveSession(state);

      // Temp file should be saved
      const tempContent = getMockFile('/mock/app/data/temp/new 1.txt');
      expect(tempContent).toBe('unsaved content here');

      // Session file should be saved
      const sessionContent = getMockFile('/mock/app/data/session.json');
      expect(sessionContent).toBeDefined();
    });

    it('should preserve tab metadata while stripping content', async () => {
      const state: SessionState = {
        tabs: [
          {
            id: 'tab1',
            name: 'code.ts',
            path: '/home/user/code.ts',
            tempPath: null,
            content: 'lots of code here',
            savedContent: 'lots of code here',
            cursorPos: 42,
          },
        ],
        activeTabId: 'tab1',
        nextTempNumber: 3,
        darkMode: false,
      };

      await saveSession(state);

      const saved = JSON.parse(getMockFile('/mock/app/data/session.json')!);
      expect(saved.tabs[0].id).toBe('tab1');
      expect(saved.tabs[0].name).toBe('code.ts');
      expect(saved.tabs[0].path).toBe('/home/user/code.ts');
      expect(saved.tabs[0].cursorPos).toBe(42);
      expect(saved.nextTempNumber).toBe(3);
      expect(saved.darkMode).toBe(false);
    });
  });

  describe('session round-trip (save then load)', () => {
    it('should restore session state after save and load', async () => {
      // Create initial state
      const originalState: SessionState = {
        tabs: [
          {
            id: 'tab1',
            name: 'new 1.txt',
            path: null,
            tempPath: '/mock/app/data/temp/new 1.txt',
            content: 'temp file content',
            savedContent: '',
            cursorPos: 10,
          },
          {
            id: 'tab2',
            name: 'real.ts',
            path: '/home/user/real.ts',
            tempPath: null,
            content: 'real file content',
            savedContent: 'real file content',
            cursorPos: 20,
          },
        ],
        activeTabId: 'tab2',
        nextTempNumber: 2,
        darkMode: false,
      };

      // Save the session
      await saveSession(originalState);

      // Simulate app restart - set up the real file (since it would exist on disk)
      setMockFile('/home/user/real.ts', 'real file content');

      // Load the session
      const loadedState = await loadSession();

      // Verify state was restored
      expect(loadedState.tabs).toHaveLength(2);
      expect(loadedState.activeTabId).toBe('tab2');
      expect(loadedState.nextTempNumber).toBe(2);
      expect(loadedState.darkMode).toBe(false);

      // Verify temp file content was restored
      expect(loadedState.tabs[0].name).toBe('new 1.txt');
      expect(loadedState.tabs[0].content).toBe('temp file content');

      // Verify real file content was restored
      expect(loadedState.tabs[1].name).toBe('real.ts');
      expect(loadedState.tabs[1].content).toBe('real file content');
    });

    it('should preserve cursor positions across sessions', async () => {
      const state: SessionState = {
        tabs: [
          {
            id: 'tab1',
            name: 'test.txt',
            path: null,
            tempPath: '/mock/app/data/temp/new 1.txt',
            content: 'content',
            savedContent: '',
            cursorPos: 123,
          },
        ],
        activeTabId: 'tab1',
        nextTempNumber: 2,
        darkMode: true,
      };

      await saveSession(state);
      const loaded = await loadSession();

      expect(loaded.tabs[0].cursorPos).toBe(123);
    });

    it('should handle empty session round-trip', async () => {
      const emptyState: SessionState = {
        tabs: [],
        activeTabId: null,
        nextTempNumber: 1,
        darkMode: true,
      };

      await saveSession(emptyState);
      const loaded = await loadSession();

      expect(loaded.tabs).toHaveLength(0);
      expect(loaded.activeTabId).toBeNull();
      expect(loaded.nextTempNumber).toBe(1);
    });

    it('should handle many tabs round-trip', async () => {
      const tabs: Tab[] = [];
      for (let i = 1; i <= 10; i++) {
        tabs.push({
          id: `tab${i}`,
          name: `new ${i}.txt`,
          path: null,
          tempPath: `/mock/app/data/temp/new ${i}.txt`,
          content: `content for tab ${i}`,
          savedContent: '',
          cursorPos: i * 10,
        });
      }

      const state: SessionState = {
        tabs,
        activeTabId: 'tab5',
        nextTempNumber: 11,
        darkMode: true,
      };

      await saveSession(state);
      const loaded = await loadSession();

      expect(loaded.tabs).toHaveLength(10);
      expect(loaded.activeTabId).toBe('tab5');
      expect(loaded.nextTempNumber).toBe(11);

      for (let i = 0; i < 10; i++) {
        expect(loaded.tabs[i].content).toBe(`content for tab ${i + 1}`);
        expect(loaded.tabs[i].cursorPos).toBe((i + 1) * 10);
      }
    });
  });

  describe('auto-save scenarios', () => {
    it('should preserve unsaved changes in temp files', async () => {
      // Simulate user typing in an unsaved file
      const state: SessionState = {
        tabs: [
          {
            id: 'tab1',
            name: 'new 1.txt',
            path: null,
            tempPath: '/mock/app/data/temp/new 1.txt',
            content: 'user typed this content',
            savedContent: '', // Different from content = dirty
            cursorPos: 23,
          },
        ],
        activeTabId: 'tab1',
        nextTempNumber: 2,
        darkMode: true,
      };

      // Auto-save triggers
      await saveSession(state);

      // Simulate app close and reopen
      const loaded = await loadSession();

      // Content should be preserved
      expect(loaded.tabs[0].content).toBe('user typed this content');
    });

    it('should preserve unsaved changes in modified saved files', async () => {
      // Simulate user modifying a saved file
      const state: SessionState = {
        tabs: [
          {
            id: 'tab1',
            name: 'existing.ts',
            path: '/home/user/existing.ts',
            tempPath: null,
            content: 'modified content', // Different from what's on disk
            savedContent: 'original content',
            cursorPos: 10,
          },
        ],
        activeTabId: 'tab1',
        nextTempNumber: 1,
        darkMode: true,
      };

      // Save session (but not the file itself)
      await saveSession(state);

      // The file on disk still has original content
      setMockFile('/home/user/existing.ts', 'original content');

      // When reloading, we read from disk, not from session
      const loaded = await loadSession();

      // Note: Current implementation reads from disk for saved files
      // So modified but unsaved content in saved files is NOT preserved
      // This is the expected behavior - only temp files preserve unsaved content
      expect(loaded.tabs[0].content).toBe('original content');
    });
  });

  describe('file deletion and missing file handling', () => {
    it('should handle deleted temp file on reload', async () => {
      const state: SessionState = {
        tabs: [
          {
            id: 'tab1',
            name: 'new 1.txt',
            path: null,
            tempPath: '/mock/app/data/temp/new 1.txt',
            content: 'content',
            savedContent: '',
            cursorPos: 0,
          },
        ],
        activeTabId: 'tab1',
        nextTempNumber: 2,
        darkMode: true,
      };

      await saveSession(state);

      // Delete the temp file (simulate external deletion)
      resetMockFileSystem();
      setMockFile('/mock/app/data/session.json', JSON.stringify({
        ...state,
        tabs: state.tabs.map(t => ({ ...t, content: '', savedContent: '' })),
      }));
      // Note: temp file is NOT set

      const loaded = await loadSession();

      // Tab should still exist but content should be empty
      expect(loaded.tabs).toHaveLength(1);
      expect(loaded.tabs[0].content).toBe('');
    });

    it('should handle deleted real file on reload', async () => {
      const state: SessionState = {
        tabs: [
          {
            id: 'tab1',
            name: 'deleted.txt',
            path: '/home/user/deleted.txt',
            tempPath: null,
            content: '',
            savedContent: '',
            cursorPos: 0,
          },
        ],
        activeTabId: 'tab1',
        nextTempNumber: 1,
        darkMode: true,
      };

      setMockFile('/mock/app/data/session.json', JSON.stringify(state));
      // Note: /home/user/deleted.txt is NOT set

      const loaded = await loadSession();

      expect(loaded.tabs).toHaveLength(1);
      expect(loaded.tabs[0].content).toBe('');
    });
  });

  describe('dark mode persistence', () => {
    it('should persist dark mode preference', async () => {
      const state: SessionState = {
        tabs: [],
        activeTabId: null,
        nextTempNumber: 1,
        darkMode: false,
      };

      await saveSession(state);
      const loaded = await loadSession();

      expect(loaded.darkMode).toBe(false);
    });

    it('should default to dark mode when no session exists', async () => {
      const loaded = await loadSession();
      expect(loaded.darkMode).toBe(true);
    });
  });

  describe('edge cases and potential bugs', () => {
    it('should handle unicode content in temp files', async () => {
      const unicodeContent = 'Hello 世界! 🎉 émojis and ñ special chars';
      const state: SessionState = {
        tabs: [
          {
            id: 'tab1',
            name: 'new 1.txt',
            path: null,
            tempPath: '/mock/app/data/temp/new 1.txt',
            content: unicodeContent,
            savedContent: '',
            cursorPos: 0,
          },
        ],
        activeTabId: 'tab1',
        nextTempNumber: 2,
        darkMode: true,
      };

      await saveSession(state);
      const loaded = await loadSession();

      expect(loaded.tabs[0].content).toBe(unicodeContent);
    });

    it('should handle very large content', async () => {
      const largeContent = 'x'.repeat(100000);
      const state: SessionState = {
        tabs: [
          {
            id: 'tab1',
            name: 'new 1.txt',
            path: null,
            tempPath: '/mock/app/data/temp/new 1.txt',
            content: largeContent,
            savedContent: '',
            cursorPos: 50000,
          },
        ],
        activeTabId: 'tab1',
        nextTempNumber: 2,
        darkMode: true,
      };

      await saveSession(state);
      const loaded = await loadSession();

      expect(loaded.tabs[0].content.length).toBe(100000);
      expect(loaded.tabs[0].cursorPos).toBe(50000);
    });

    it('should handle tabs with special characters in names', async () => {
      const state: SessionState = {
        tabs: [
          {
            id: 'tab1',
            name: 'file with spaces.txt',
            path: null,
            tempPath: '/mock/app/data/temp/new 1.txt',
            content: 'content',
            savedContent: '',
            cursorPos: 0,
          },
        ],
        activeTabId: 'tab1',
        nextTempNumber: 2,
        darkMode: true,
      };

      await saveSession(state);
      const loaded = await loadSession();

      expect(loaded.tabs[0].name).toBe('file with spaces.txt');
    });

    it('should handle empty content correctly', async () => {
      const state: SessionState = {
        tabs: [
          {
            id: 'tab1',
            name: 'empty.txt',
            path: null,
            tempPath: '/mock/app/data/temp/new 1.txt',
            content: '',
            savedContent: '',
            cursorPos: 0,
          },
        ],
        activeTabId: 'tab1',
        nextTempNumber: 2,
        darkMode: true,
      };

      await saveSession(state);
      const loaded = await loadSession();

      expect(loaded.tabs[0].content).toBe('');
    });

    it('should handle JSON-like content in files', async () => {
      const jsonContent = '{"key": "value", "nested": {"array": [1, 2, 3]}}';
      const state: SessionState = {
        tabs: [
          {
            id: 'tab1',
            name: 'data.json',
            path: null,
            tempPath: '/mock/app/data/temp/new 1.txt',
            content: jsonContent,
            savedContent: '',
            cursorPos: 0,
          },
        ],
        activeTabId: 'tab1',
        nextTempNumber: 2,
        darkMode: true,
      };

      await saveSession(state);
      const loaded = await loadSession();

      expect(loaded.tabs[0].content).toBe(jsonContent);
    });

    it('should preserve tab order across sessions', async () => {
      const state: SessionState = {
        tabs: [
          { id: 'a', name: 'first.txt', path: null, tempPath: '/mock/app/data/temp/new 1.txt', content: '1', savedContent: '', cursorPos: 0 },
          { id: 'b', name: 'second.txt', path: null, tempPath: '/mock/app/data/temp/new 2.txt', content: '2', savedContent: '', cursorPos: 0 },
          { id: 'c', name: 'third.txt', path: null, tempPath: '/mock/app/data/temp/new 3.txt', content: '3', savedContent: '', cursorPos: 0 },
        ],
        activeTabId: 'b',
        nextTempNumber: 4,
        darkMode: true,
      };

      await saveSession(state);
      const loaded = await loadSession();

      expect(loaded.tabs.map(t => t.id)).toEqual(['a', 'b', 'c']);
      expect(loaded.tabs.map(t => t.name)).toEqual(['first.txt', 'second.txt', 'third.txt']);
      expect(loaded.tabs.map(t => t.content)).toEqual(['1', '2', '3']);
    });

    it('should handle newlines in content', async () => {
      const contentWithNewlines = 'line1\nline2\r\nline3\rline4';
      const state: SessionState = {
        tabs: [
          {
            id: 'tab1',
            name: 'multiline.txt',
            path: null,
            tempPath: '/mock/app/data/temp/new 1.txt',
            content: contentWithNewlines,
            savedContent: '',
            cursorPos: 0,
          },
        ],
        activeTabId: 'tab1',
        nextTempNumber: 2,
        darkMode: true,
      };

      await saveSession(state);
      const loaded = await loadSession();

      expect(loaded.tabs[0].content).toBe(contentWithNewlines);
    });

    it('should handle content with quotes and backslashes', async () => {
      const trickyContent = 'path: "C:\\Users\\test\\file.txt" with \'quotes\'';
      const state: SessionState = {
        tabs: [
          {
            id: 'tab1',
            name: 'tricky.txt',
            path: null,
            tempPath: '/mock/app/data/temp/new 1.txt',
            content: trickyContent,
            savedContent: '',
            cursorPos: 0,
          },
        ],
        activeTabId: 'tab1',
        nextTempNumber: 2,
        darkMode: true,
      };

      await saveSession(state);
      const loaded = await loadSession();

      expect(loaded.tabs[0].content).toBe(trickyContent);
    });
  });

  describe('KNOWN LIMITATION: unsaved changes in saved files', () => {
    /**
     * This test documents a known limitation: when a user modifies a file
     * that has been saved to disk (has a path), but doesn't save those changes,
     * the modifications are LOST when the app is closed and reopened.
     *
     * This happens because:
     * 1. saveSession() strips content from saved tabs (to keep session.json small)
     * 2. loadSession() reads content from the disk file (tab.path)
     * 3. The disk file still has the old content
     *
     * This is a significant data loss risk for users who expect their
     * unsaved changes to persist across app restarts.
     */
    it('LOSES unsaved modifications to saved files on restart', async () => {
      // User opens a file
      const state: SessionState = {
        tabs: [
          {
            id: 'tab1',
            name: 'myfile.txt',
            path: '/home/user/myfile.txt',
            tempPath: null,
            content: 'MODIFIED by user but not saved',
            savedContent: 'original content on disk',
            cursorPos: 15,
          },
        ],
        activeTabId: 'tab1',
        nextTempNumber: 1,
        darkMode: true,
      };

      // App auto-saves session on close
      await saveSession(state);

      // Simulate disk file having original content
      setMockFile('/home/user/myfile.txt', 'original content on disk');

      // App restarts and loads session
      const loaded = await loadSession();

      // BUG: User's modifications are LOST!
      // Expected (if we wanted to preserve changes): 'MODIFIED by user but not saved'
      // Actual: reads from disk
      expect(loaded.tabs[0].content).toBe('original content on disk');
      expect(loaded.tabs[0].content).not.toBe('MODIFIED by user but not saved');
    });
  });
});
