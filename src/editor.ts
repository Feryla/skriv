import * as monaco from 'monaco-editor';

// Language mapping based on file extension
export function getLanguageFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  
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
  // Light theme (similar to VS Code light)
  monaco.editor.defineTheme('simple-light', {
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

  // Dark theme (similar to One Dark)
  monaco.editor.defineTheme('simple-dark', {
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
  onChange: (content: string) => void
): monaco.editor.IStandaloneCodeEditor {
  const language = getLanguageFromFilename(filename);
  
  const editor = monaco.editor.create(container, {
    value: content,
    language,
    theme: darkMode ? 'simple-dark' : 'simple-light',
    automaticLayout: true,
    minimap: { enabled: true },
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
    lineNumbers: 'on',
    renderWhitespace: 'selection',
    scrollBeyondLastLine: false,
    wordWrap: 'off',
    tabSize: 2,
    insertSpaces: true,
    folding: true,
    // Column selection with middle mouse or Alt+Shift
    columnSelection: true,
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

export function formatDocument(editor: monaco.editor.IStandaloneCodeEditor): void {
  editor.getAction('editor.action.formatDocument')?.run();
}

export function setEditorLanguage(editor: monaco.editor.IStandaloneCodeEditor, filename: string): void {
  const model = editor.getModel();
  if (model) {
    const language = getLanguageFromFilename(filename);
    monaco.editor.setModelLanguage(model, language);
  }
}

export function setEditorTheme(darkMode: boolean): void {
  monaco.editor.setTheme(darkMode ? 'simple-dark' : 'simple-light');
}

export { monaco };
