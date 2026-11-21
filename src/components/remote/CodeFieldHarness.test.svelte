<script lang="ts">
  import CodeField from './CodeField.svelte';

  const { onSubmit }: { onSubmit?: () => void } = $props();
  let code = $state('');
</script>

<CodeField value={code} onChange={(next) => { code = next; }} {onSubmit} />
<output data-testid="code">{code}</output>
