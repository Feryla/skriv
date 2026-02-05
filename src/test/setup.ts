import { vi } from 'vitest';

// Mock file system storage
export const mockFileSystem: Map<string, string> = new Map();

// Mock Tauri path API
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/mock/app/data'),
  join: vi.fn((...paths: string[]) => Promise.resolve(paths.join('/'))),
}));

// Mock Tauri fs plugin
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn((path: string) => Promise.resolve(mockFileSystem.has(path))),
  mkdir: vi.fn(() => Promise.resolve()),
  readTextFile: vi.fn((path: string) => {
    const content = mockFileSystem.get(path);
    if (content === undefined) {
      return Promise.reject(new Error(`File not found: ${path}`));
    }
    return Promise.resolve(content);
  }),
  writeTextFile: vi.fn((path: string, content: string) => {
    mockFileSystem.set(path, content);
    return Promise.resolve();
  }),
  remove: vi.fn((path: string) => {
    mockFileSystem.delete(path);
    return Promise.resolve();
  }),
  BaseDirectory: {
    AppData: 0,
  },
}));

// Helper to reset mocks between tests
export function resetMockFileSystem(): void {
  mockFileSystem.clear();
}

// Helper to set up a mock file
export function setMockFile(path: string, content: string): void {
  mockFileSystem.set(path, content);
}

// Helper to get mock file content
export function getMockFile(path: string): string | undefined {
  return mockFileSystem.get(path);
}

// Helper to check if mock file exists
export function mockFileExists(path: string): boolean {
  return mockFileSystem.has(path);
}
