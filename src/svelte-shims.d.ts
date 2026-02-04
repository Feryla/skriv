/// <reference types="svelte" />
declare namespace svelteHTML {
  interface HTMLAttributes<T> {
    'on:click'?: (event: MouseEvent) => void;
    'on:keydown'?: (event: KeyboardEvent) => void;
  }
}
