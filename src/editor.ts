import type * as Monaco from 'monaco-editor';

let _monaco: typeof Monaco | null = null;

export async function loadMonaco(): Promise<typeof Monaco> {
  if (!_monaco) {
    _monaco = await import('monaco-editor');
  }
  return _monaco;
}

// Language mapping based on file extension
export function getLanguageFromFilename(filename: string): string {
  const name = filename.split('/').pop()?.toLowerCase() || '';
  const ext = name.split('.').pop()?.toLowerCase();

  // Dotenv files: .env, .env.local, .env.production, etc.
  if (name === '.env' || name.startsWith('.env.')) return 'ini';

  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript
    'js': 'javascript',
    'mjs': 'javascript',
    'cjs': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'mts': 'typescript',
    'cts': 'typescript',
    'tsx': 'typescript',
    // Web
    'html': 'html',
    'htm': 'html',
    'svelte': 'html',
    'vue': 'html',
    'css': 'css',
    'scss': 'scss',
    'less': 'less',
    // Data
    'json': 'json',
    'xml': 'xml',
    'svg': 'xml',
    'yaml': 'yaml',
    'yml': 'yaml',
    // Markdown
    'md': 'markdown',
    'markdown': 'markdown',
    // Programming
    'java': 'java',
    'sql': 'sql',
    'py': 'python',
    'rb': 'ruby',
    'go': 'go',
    'rs': 'rust',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'cs': 'csharp',
    'php': 'php',
    'sh': 'shell',
    'bash': 'shell',
    'ps1': 'powershell',
    'bat': 'bat',
    'cmd': 'bat',
    // Config
    'ini': 'ini',
    'conf': 'ini',
    'toml': 'ini',
    'properties': 'ini',
  };

  return languageMap[ext || ''] || 'plaintext';
}

// Define themes
export function setupThemes() {
  _monaco!.editor.defineTheme('simple-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#24292e',
      'editorLineNumber.foreground': '#6a737d',
      'editorLineNumber.activeForeground': '#24292e',
      'editor.lineHighlightBackground': '#f6f8fa',
      'editorCursor.foreground': '#24292e',
    },
  });

  _monaco!.editor.defineTheme('simple-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#1e1e1e',
      'editor.foreground': '#d4d4d4',
      'editorLineNumber.foreground': '#858585',
      'editorLineNumber.activeForeground': '#c6c6c6',
      'editor.lineHighlightBackground': '#2a2a2a',
      'editorCursor.foreground': '#d4d4d4',
    },
  });
}

export function createEditor(
  container: HTMLElement,
  content: string,
  filename: string,
  darkMode: boolean,
  onChange: (content: string) => void,
  columnSelection: boolean = false
): Monaco.editor.IStandaloneCodeEditor {
  const language = getLanguageFromFilename(filename);

  const editor = _monaco!.editor.create(container, {
    value: content,
    language,
    theme: darkMode ? 'simple-dark' : 'simple-light',
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
    lineNumbers: 'on',
    renderWhitespace: 'selection',
    scrollBeyondLastLine: false,
    wordWrap: 'off',
    tabSize: 2,
    insertSpaces: true,
    folding: true,
    columnSelection,
    // Better find/replace
    find: {
      addExtraSpaceOnTop: false,
      autoFindInSelection: 'multiline',
      seedSearchStringFromSelection: 'selection',
    },
  });

  // Listen for content changes
  editor.onDidChangeModelContent(() => {
    onChange(editor.getValue());
  });

  return editor;
}

export function formatDocument(editor: Monaco.editor.IStandaloneCodeEditor): void {
  editor.getAction('editor.action.formatDocument')?.run();
}

export function setEditorLanguage(editor: Monaco.editor.IStandaloneCodeEditor, filename: string): void {
  const model = editor.getModel();
  if (model && _monaco) {
    const language = getLanguageFromFilename(filename);
    _monaco.editor.setModelLanguage(model, language);
  }
}

export function setEditorTheme(darkMode: boolean): void {
  _monaco?.editor.setTheme(darkMode ? 'simple-dark' : 'simple-light');
}
