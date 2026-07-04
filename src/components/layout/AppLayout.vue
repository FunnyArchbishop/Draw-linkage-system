<template>
  <div class="app-layout">
    <header class="app-header">
      <h1>Track Generation — Multi-Bar Linkage</h1>
      <div class="header-subtitle">手绘轨迹 · 差分进化优化 · 多连杆机构最大程度拟合</div>
    </header>
    <main class="app-main">
      <section class="panel canvas-section"><UnifiedCanvas /></section>
      <section class="panel control-section"><ControlPanel /></section>
    </main>
  </div>
</template>

<script setup>
import UnifiedCanvas from '../canvas/UnifiedCanvas.vue'
import ControlPanel from '../panels/ControlPanel.vue'
</script>

<style scoped>
.app-layout { display:flex; flex-direction:column; height:100vh; overflow:hidden }
.app-header { padding:10px 20px; background:linear-gradient(135deg,#0a192f,#112240); border-bottom:1px solid #1a3a5c; display:flex; align-items:baseline; gap:16px; flex-shrink:0 }
.app-header h1 { margin:0; color:#64ffda; font-size:20px; font-weight:600 }
.header-subtitle { color:#5a6a8a; font-size:13px }
.app-main { flex:1; display:grid; grid-template-areas:"controls canvas"; grid-template-columns:340px 1fr; grid-template-rows:1fr; gap:8px; padding:8px; background:#060d1a; overflow:hidden }
.canvas-section { grid-area:canvas } .control-section { grid-area:controls; overflow-y:auto } .panel { overflow:hidden }
@media (max-width:800px) { .app-main { grid-template-areas:"canvas" "controls"; grid-template-columns:1fr; grid-template-rows:1fr auto } }
</style>
