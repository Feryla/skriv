<script lang="ts">
  import type { Tab } from './store';

  let {
    tabs,
    selectedIndex,
    darkMode,
  }: {
    tabs: Tab[];
    selectedIndex: number;
    darkMode: boolean;
  } = $props();

  let listEl: HTMLDivElement;

  $effect(() => {
    if (listEl && selectedIndex >= 0) {
      const items = listEl.querySelectorAll('.switcher-item');
      items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  });

  function getDirectory(path: string): string {
    return path.replace(/[/\\][^/\\]*$/, '');
  }
</script>

<div class="switcher-backdrop">
  <div class="switcher" class:dark={darkMode}>
    <div class="switcher-header">Open Files</div>
    <div class="switcher-list" bind:this={listEl}>
      {#each tabs as tab, i (tab.id)}
        <div class="switcher-item" class:selected={i === selectedIndex}>
          <span class="switcher-item-name">
            {tab.name}
            {#if tab.content !== tab.savedContent}
              <span class="switcher-dirty">&bull;</span>
            {/if}
          </span>
          {#if tab.path}
            <span class="switcher-item-path">{getDirectory(tab.path)}</span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .switcher-backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999;
    background: rgba(0, 0, 0, 0.15);
  }

  .switcher {
    background: #f6f8fa;
    border: 1px solid #d0d7de;
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
    min-width: 350px;
    max-width: 550px;
    max-height: 400px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  }

  .switcher.dark {
    background: #2d2d2d;
    border-color: #4a4a4a;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .switcher-header {
    padding: 10px 16px 8px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #656d76;
    border-bottom: 1px solid #d0d7de;
  }

  .dark .switcher-header {
    color: #858585;
    border-bottom-color: #404040;
  }

  .switcher-list {
    overflow-y: auto;
    padding: 4px 0;
  }

  .switcher-item {
    padding: 8px 16px;
    cursor: default;
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .switcher-item.selected {
    background: #0366d6;
    color: white;
  }

  .switcher-item-name {
    font-size: 13px;
    font-weight: 500;
    flex-shrink: 0;
  }

  .switcher-item-path {
    font-size: 12px;
    color: #656d76;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .dark .switcher-item-path {
    color: #858585;
  }

  .switcher-item.selected .switcher-item-path {
    color: rgba(255, 255, 255, 0.75);
  }

  .switcher-dirty {
    color: #f97316;
    font-size: 10px;
    margin-left: 2px;
  }

  .switcher-item.selected .switcher-dirty {
    color: #fbbf24;
  }
</style>
