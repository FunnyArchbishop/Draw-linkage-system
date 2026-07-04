<template>
  <div class="unified-canvas-panel">
    <div class="canvas-wrapper" ref="wrapperRef">
      <canvas ref="canvasRef"
        @pointerdown="onPointerDown" @pointermove="onPointerMove"
        @pointerup="onPointerUp" @pointerleave="onPointerUp"
        @wheel.prevent="onWheel" @contextmenu.prevent
      ></canvas>
      <div v-if="showHint" class="canvas-hint">
        🖱 在此绘制闭合轨迹<br><small>滚轮缩放 · 中键拖拽平移</small>
      </div>
      <div class="zoom-badge">{{ Math.round(canvas.view.zoom * 100) }}%</div>
    </div>
    <div class="canvas-toolbar">
      <button class="tool-btn" @click="canvas.zoomOut()">🔍−</button>
      <button class="tool-btn" @click="canvas.zoomIn()">🔍+</button>
      <button class="tool-btn" @click="canvas.resetView()">↺ 重置</button>
      <span class="tool-sep"></span>
      <button class="tool-btn" @click="clearAll()">🗑 清除</button>
      <button v-if="linkage.state.params" class="tool-btn"
        :class="linkage.state.isAnimating ? 'stop-btn' : 'play-btn'"
        @click="linkage.state.isAnimating ? linkage.stopAnimation() : linkage.startAnimation()"
      >{{ linkage.state.isAnimating ? '⏹ 停止' : '▶ 播放' }}</button>
      <span class="point-badge">点:{{ trajectory.pointCount.value }} | 误差:{{ linkage.state.error ? linkage.state.error.toFixed(4) : '—' }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useCanvas } from '../../composables/useCanvas.js'
import { useTrajectory } from '../../composables/useTrajectory.js'
import { useLinkage } from '../../composables/useLinkage.js'

const canvas = useCanvas(); const trajectory = useTrajectory(); const linkage = useLinkage()
const canvasRef = ref(null); const wrapperRef = ref(null)
let resizeObserver = null, animFrameId = null, lastTime = 0, isPanning = false, panStart = { x: 0, y: 0 }

const showHint = computed(() => trajectory.pointCount.value === 0)

function clearAll() { linkage.stopAnimation(); linkage.reset(); trajectory.clearPoints() }

function getPos(e) { const r = canvasRef.value.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }

function onPointerDown(e) {
  if (!canvasRef.value) return
  if (e.button === 1 || (e.button === 0 && e.ctrlKey)) { isPanning = true; panStart = getPos(e); canvasRef.value.setPointerCapture(e.pointerId); return }
  if (e.button === 0) { canvasRef.value.setPointerCapture(e.pointerId); const w = canvas.toWorld(getPos(e).x, getPos(e).y); trajectory.startStroke(); trajectory.addPoint(w.x, w.y) }
}

function onPointerMove(e) {
  if (!canvasRef.value) return
  if (isPanning) { const p = getPos(e); canvas.panBy(p.x - panStart.x, p.y - panStart.y); panStart = p; return }
  if (trajectory.state.isDrawing) { const w = canvas.toWorld(getPos(e).x, getPos(e).y); trajectory.addPoint(w.x, w.y) }
}

function onPointerUp(_e) { if (isPanning) { isPanning = false } else if (trajectory.state.isDrawing) trajectory.endStroke() }

function onWheel(e) { const p = getPos(e); canvas.zoomAt(p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15) }

function renderFrame(ts) {
  const dt = lastTime ? Math.min((ts - lastTime) / 1000, 0.1) : 0.016; lastTime = ts
  if (linkage.state.isAnimating) linkage.tick(dt)
  if (!canvas.ctx() || canvas.state.canvasWidth === 0) { animFrameId = requestAnimationFrame(renderFrame); return }

  canvas.clear(); canvas.drawGrid(); canvas.drawAxes()

  const pts = trajectory.state.points; const anim = linkage.state.isAnimating

  // 轨迹曲线（动画时变淡）
  if (pts.length >= 2) canvas.drawPolyline(pts, anim ? 'rgba(33,150,243,0.2)' : '#2196F3', anim ? 1.5 : 2.5, anim)

  // 连杆机构
  const { currentState, tracePoints, couplerCurve } = linkage.state
  const isMultiBar = linkage.state.linkageType !== 'fourbar'
  if (anim) {
    if (tracePoints.length >= 2) canvas.drawPolyline(tracePoints, '#4CAF50', 2.5)
    if (currentState) {
      const { O2, O4, O6, A, B, D, E, P } = currentState

      // 地面连杆 (O₂—O₄ 和 O₄—O₆)
      if (O2 && O4) canvas.drawLine(O2.x, O2.y, O4.x, O4.y, '#666', 2)
      if (isMultiBar && O4 && O6) canvas.drawLine(O4.x, O4.y, O6.x, O6.y, '#555', 2)
      if (isMultiBar && O2 && O6) canvas.drawLine(O2.x, O2.y, O6.x, O6.y, 'rgba(100,100,100,0.3)', 1)

      // 回路1
      if (O2 && A) canvas.drawLine(O2.x, O2.y, A.x, A.y, '#F44336', 3)
      if (A && B) canvas.drawLine(A.x, A.y, B.x, B.y, '#2196F3', 3)
      if (B && O4) canvas.drawLine(B.x, B.y, O4.x, O4.y, '#FF9800', 3)

      // 回路2 (六杆)
      if (isMultiBar && D && E) {
        if (O4 && D) canvas.drawLine(O4.x, O4.y, D.x, D.y, '#E91E63', 3)
        canvas.drawLine(D.x, D.y, E.x, E.y, '#00BCD4', 3)
        if (E && O6) canvas.drawLine(E.x, E.y, O6.x, O6.y, '#9C27B0', 3)
        // 耦合连杆 B—D
        if (B && D) canvas.drawLine(B.x, B.y, D.x, D.y, 'rgba(255,255,255,0.4)', 1.5)
      }

      // 输出连杆 (A→P)
      if (A && P) canvas.drawLine(A.x, A.y, P.x, P.y, 'rgba(76,175,80,0.5)', 2)

      // 枢轴点
      if (O2) canvas.drawCircle(O2.x, O2.y, 7, '#F44336')
      if (O4) canvas.drawCircle(O4.x, O4.y, 7, '#FF9800')
      if (isMultiBar && O6) canvas.drawCircle(O6.x, O6.y, 7, '#9C27B0')

      // 铰接点
      if (A) canvas.drawCircle(A.x, A.y, 5, '#FF5252')
      if (B) canvas.drawCircle(B.x, B.y, 5, '#FFB74D')
      if (isMultiBar && D) canvas.drawCircle(D.x, D.y, 5, '#E91E63')
      if (isMultiBar && E) canvas.drawCircle(E.x, E.y, 5, '#CE93D8')

      // 输出点
      if (P) canvas.drawCircle(P.x, P.y, 5, '#4CAF50')
    }
    if (couplerCurve.length > 0) canvas.drawPolyline(couplerCurve, 'rgba(76,175,80,0.2)', 1, true)
  } else if (couplerCurve.length > 0) {
    canvas.drawPolyline(couplerCurve, '#4CAF50', 2)
  }

  // Pivot 标签
  const pivO2 = linkage.state.O2 || trajectory.state.pivotO2
  const pivO4 = linkage.state.O4 || trajectory.state.pivotO4
  const pivO6 = linkage.state.O6 || trajectory.state.pivotO6
  if (pivO2) { canvas.drawCircle(pivO2.x, pivO2.y, 6, '#F44336'); if (canvas.view.zoom > 0.4) canvas.drawText('O2', pivO2.x, pivO2.y, '#D32F2F', 13) }
  if (pivO4) { canvas.drawCircle(pivO4.x, pivO4.y, 6, '#FF9800'); if (canvas.view.zoom > 0.4) canvas.drawText('O4', pivO4.x, pivO4.y, '#E65100', 13) }
  if (pivO6) { canvas.drawCircle(pivO6.x, pivO6.y, 6, '#9C27B0'); if (canvas.view.zoom > 0.4) canvas.drawText('O6', pivO6.x, pivO6.y, '#7B1FA2', 13) }

  animFrameId = requestAnimationFrame(renderFrame)
}

onMounted(() => {
  if (canvasRef.value) canvas.setup(canvasRef.value)
  requestAnimationFrame(() => { if (canvasRef.value) canvas.resize(canvasRef.value); lastTime = performance.now(); animFrameId = requestAnimationFrame(renderFrame) })
  resizeObserver = new ResizeObserver(() => { if (canvasRef.value) canvas.resize(canvasRef.value) })
  if (wrapperRef.value) resizeObserver.observe(wrapperRef.value)
})
onUnmounted(() => { if (animFrameId) cancelAnimationFrame(animFrameId); if (resizeObserver) resizeObserver.disconnect() })
</script>

<style scoped>
.unified-canvas-panel { display:flex; flex-direction:column; height:100%; background:#0a192f; border-radius:8px; overflow:hidden }
.canvas-wrapper { flex:1; position:relative; min-height:300px; overflow:hidden }
.canvas-wrapper canvas { width:100%; height:100%; display:block; background:#f8f9fa; touch-action:none }
.canvas-hint { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); color:#aaa; font-size:15px; pointer-events:none; text-align:center; line-height:1.8 }
.canvas-hint small { font-size:12px; color:#bbb }
.zoom-badge { position:absolute; bottom:8px; right:8px; background:rgba(0,0,0,.55); color:#fff; padding:2px 8px; border-radius:4px; font:11px monospace; pointer-events:none }
.canvas-toolbar { display:flex; align-items:center; gap:6px; padding:6px 10px; background:#112240; flex-shrink:0; flex-wrap:wrap }
.tool-btn { padding:5px 10px; border:1px solid #1a3a5c; background:#0a192f; color:#8892b0; font-size:12px; border-radius:4px; cursor:pointer; transition:all .15s; font-family:inherit; white-space:nowrap }
.tool-btn:hover { border-color:#64ffda; color:#ccd6f6 }
.tool-sep { width:1px; height:20px; background:#1a3a5c; margin:0 2px }
.play-btn { border-color:#1a4a3a; color:#4CAF50 } .play-btn:hover { border-color:#4CAF50; background:#1a2a1a }
.stop-btn { border-color:#4a2a2a; color:#F44336 } .stop-btn:hover { border-color:#F44336; background:#2a1a1a }
.point-badge { margin-left:auto; color:#5a6a8a; font:11px monospace }
</style>
