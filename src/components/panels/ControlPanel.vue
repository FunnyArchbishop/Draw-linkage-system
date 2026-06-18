<template>
  <div class="control-panel">
    <LinkagePanel />
  </div>
</template>

<script setup>
import LinkagePanel from './LinkagePanel.vue'
</script>

<style scoped>
.control-panel { display:flex; flex-direction:column; background:#0a192f; border-radius:8px; overflow:hidden; overflow-y:auto }
</style>
