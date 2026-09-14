<script lang="ts">
  import type { Snippet } from 'svelte';
  import Panel from '@/components/chrome/Panel.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';

  const {
    code,
    title,
    subject,
    enabled,
    onToggle,
    children,
  }: {
    code: string;
    title: string;
    subject: string;
    enabled: boolean;
    onToggle: () => void;
    children: Snippet;
  } = $props();
</script>

<Panel {code} {title}>
  {#snippet right()}
    <ToggleSwitch
      size="sm"
      checked={enabled}
      ariaLabel={enabled ? `Disable ${subject}` : `Enable ${subject}`}
      onChange={onToggle}
    />
  {/snippet}

  {@render children()}
</Panel>
