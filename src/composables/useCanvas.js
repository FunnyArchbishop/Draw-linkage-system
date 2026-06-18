/**
 * Canvas 设置、DPI 缩放、坐标变换、缩放/平移。
 * 模块级单例——跨所有 canvas 组件共享。
 */
import { reactive, ref, computed } from 'vue'

const state = reactive({
  canvasWidth: 600,
  canvasHeight: 500,
  dpr: 1
})

const worldBounds = reactive({
  xMin: -12, xMax: 12,
  yMin: -12, yMax: 12
})

// 缩放/平移视图状态
const view = reactive({
  zoom: 1,
  panX: 0,
  panY: 0
})

const ctxRef = ref(null)
const canvasRef = ref(null)

export function useCanvas() {
  function setup(canvas) {
    if (!canvas) return
    canvasRef.value = canvas
    const dpr = window.devicePixelRatio || 1
    state.dpr = dpr
    const rect = canvas.getBoundingClientRect()
    state.canvasWidth = rect.width
    state.canvasHeight = rect.height
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctxRef.value = ctx
  }

  function resize(canvas) {
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    state.dpr = dpr
    const rect = canvas.getBoundingClientRect()
    state.canvasWidth = rect.width
    state.canvasHeight = rect.height
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctxRef.value = ctx
  }

  function ctx() {
    return ctxRef.value
  }

  // 世界坐标中心（缩放原点）
  function worldCenter() {
    return {
      x: (worldBounds.xMin + worldBounds.xMax) / 2,
      y: (worldBounds.yMin + worldBounds.yMax) / 2
    }
  }

  /**
   * 计算均匀缩放比例和居中偏移。
   * X/Y 使用相同像素/单位比，确保杆件在各方向显示长度一致。
   */
  function getUniformTransform() {
    const w = state.canvasWidth
    const h = state.canvasHeight
    const rx = worldBounds.xMax - worldBounds.xMin
    const ry = worldBounds.yMax - worldBounds.yMin
    const scale = Math.min(w / rx, h / ry)
    const offsetX = (w - rx * scale) / 2
    const offsetY = (h - ry * scale) / 2
    return { scale, offsetX, offsetY, w, h, rx, ry }
  }

  /**
   * 屏幕坐标 → 世界坐标（含缩放/平移逆变换）
   */
  function toWorld(screenX, screenY) {
    const { scale, offsetX, offsetY, w, h, rx, ry } = getUniformTransform()
    if (w === 0 || h === 0) return { x: 0, y: 0 }

    // 屏幕 → 基础世界坐标（均匀缩放，Y 翻转）
    let wx = (screenX - offsetX) / scale + worldBounds.xMin
    let wy = worldBounds.yMax - (screenY - offsetY) / scale

    // 应用缩放/平移逆变换
    const cx = (worldBounds.xMin + worldBounds.xMax) / 2
    const cy = (worldBounds.yMin + worldBounds.yMax) / 2
    wx = (wx - cx) / view.zoom + cx - view.panX
    wy = (wy - cy) / view.zoom + cy - view.panY

    return { x: wx, y: wy }
  }

  /**
   * 世界坐标 → 屏幕坐标（含缩放/平移，均匀缩放）
   */
  function toScreen(worldX, worldY) {
    const { scale, offsetX, offsetY, w, h } = getUniformTransform()
    if (w === 0 || h === 0) return { x: 0, y: 0 }

    const cx = (worldBounds.xMin + worldBounds.xMax) / 2
    const cy = (worldBounds.yMin + worldBounds.yMax) / 2

    // 在世界空间应用缩放/平移
    let wx = (worldX + view.panX - cx) * view.zoom + cx
    let wy = (worldY + view.panY - cy) * view.zoom + cy

    // 世界 → 屏幕（均匀缩放）
    let sx = (wx - worldBounds.xMin) * scale + offsetX
    let sy = (worldBounds.yMax - wy) * scale + offsetY

    return { x: sx, y: sy }
  }

  /**
   * 以屏幕某点为中心进行缩放
   */
  function zoomAt(screenX, screenY, factor) {
    const before = toWorld(screenX, screenY)
    view.zoom = Math.max(0.05, Math.min(20, view.zoom * factor))
    const after = toWorld(screenX, screenY)
    view.panX += after.x - before.x
    view.panY += after.y - before.y
  }

  /**
   * 按屏幕像素平移
   */
  function panBy(screenDX, screenDY) {
    const { scale, w, h } = getUniformTransform()
    if (w === 0 || h === 0 || scale === 0) return
    // 屏幕像素 → 世界单位（均匀缩放，Y 翻转用于平移）
    view.panX -= screenDX / (scale * view.zoom)
    view.panY += screenDY / (scale * view.zoom)
  }

  function resetView() {
    view.zoom = 1
    view.panX = 0
    view.panY = 0
  }

  function zoomIn() {
    const w = state.canvasWidth, h = state.canvasHeight
    zoomAt(w / 2, h / 2, 1.3)
  }

  function zoomOut() {
    const w = state.canvasWidth, h = state.canvasHeight
    zoomAt(w / 2, h / 2, 1 / 1.3)
  }

  // ---- 绘图辅助函数（内部使用 toScreen） ----

  function clear() {
    const c = ctxRef.value
    if (!c) return
    // 填充整个 canvas 背景（覆盖均匀缩放产生的 letterbox 边距）
    c.save()
    c.setTransform(state.dpr, 0, 0, state.dpr, 0, 0)
    c.fillStyle = '#f8f9fa'
    c.fillRect(0, 0, state.canvasWidth, state.canvasHeight)
    c.restore()
  }

  function drawGrid() {
    const c = ctxRef.value
    if (!c || view.zoom < 0.2) return
    c.save()
    c.strokeStyle = '#e0e0e0'
    c.lineWidth = 0.5

    const rx = worldBounds.xMax - worldBounds.xMin
    const ry = worldBounds.yMax - worldBounds.yMin
    const stepX = rx / 10
    const stepY = ry / 10

    // 基于缩放级别的动态网格密度
    const gridStep = view.zoom > 3 ? 1 : (view.zoom > 1.5 ? 2 : (view.zoom > 0.6 ? 5 : 10))
    const subStep = Math.max(1, Math.round(10 / gridStep))

    for (let i = 0; i <= 10; i += subStep) {
      const wx = worldBounds.xMin + i * stepX
      const p1 = toScreen(wx, worldBounds.yMin)
      const p2 = toScreen(wx, worldBounds.yMax)
      if (isFinite(p1.x) && isFinite(p2.x)) {
        c.beginPath(); c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.stroke()
      }
    }
    for (let i = 0; i <= 10; i += subStep) {
      const wy = worldBounds.yMin + i * stepY
      const p1 = toScreen(worldBounds.xMin, wy)
      const p2 = toScreen(worldBounds.xMax, wy)
      if (isFinite(p1.x) && isFinite(p2.x)) {
        c.beginPath(); c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.stroke()
      }
    }
    c.restore()
  }

  function drawAxes() {
    const c = ctxRef.value
    if (!c) return
    const origin = toScreen(0, 0)
    c.save()
    c.strokeStyle = '#aaa'
    c.lineWidth = 1.5
    c.beginPath(); c.moveTo(0, origin.y); c.lineTo(state.canvasWidth, origin.y); c.stroke()
    c.beginPath(); c.moveTo(origin.x, 0); c.lineTo(origin.x, state.canvasHeight); c.stroke()
    c.restore()
  }

  function drawCircle(worldX, worldY, radius, color, fill = true) {
    const c = ctxRef.value
    if (!c) return
    const p = toScreen(worldX, worldY)
    // radius 为屏幕像素——位置跟踪世界坐标 via toScreen，
    // 但半径为独立于缩放级别的固定视觉大小
    c.save()
    c.beginPath()
    c.arc(p.x, p.y, Math.max(1, radius), 0, Math.PI * 2)
    if (fill) { c.fillStyle = color; c.fill() }
    else { c.strokeStyle = color; c.lineWidth = 2; c.stroke() }
    c.restore()
  }

  function drawPolyline(points, color, lineWidth = 2, dashed = false) {
    const c = ctxRef.value
    if (!c || points.length < 2) return
    c.save()
    c.strokeStyle = color
    c.lineWidth = lineWidth
    c.lineCap = 'round'
    c.lineJoin = 'round'
    if (dashed) c.setLineDash([6, 4])
    c.beginPath()
    const first = toScreen(points[0].x, points[0].y)
    c.moveTo(first.x, first.y)
    for (let i = 1; i < points.length; i++) {
      const p = toScreen(points[i].x, points[i].y)
      c.lineTo(p.x, p.y)
    }
    c.stroke()
    c.setLineDash([])
    c.restore()
  }

  function drawLine(x1, y1, x2, y2, color, lineWidth = 2) {
    const c = ctxRef.value
    if (!c) return
    const p1 = toScreen(x1, y1)
    const p2 = toScreen(x2, y2)
    c.save()
    c.strokeStyle = color
    c.lineWidth = lineWidth
    c.lineCap = 'round'
    c.beginPath(); c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.stroke()
    c.restore()
  }

  function drawText(text, worldX, worldY, color = '#333', fontSize = 12) {
    const c = ctxRef.value
    if (!c) return
    const p = toScreen(worldX, worldY)
    c.save()
    c.fillStyle = color
    c.font = `${fontSize}px monospace`
    c.fillText(text, p.x + 5, p.y - 5)
    c.restore()
  }

  function drawScreenCircle(sx, sy, radius, color) {
    const c = ctxRef.value
    if (!c) return
    c.save()
    c.beginPath()
    c.arc(sx, sy, radius, 0, Math.PI * 2)
    c.fillStyle = color
    c.fill()
    c.restore()
  }

  return {
    state, worldBounds, view,
    setup, resize, ctx,
    toWorld, toScreen,
    zoomAt, panBy, resetView, zoomIn, zoomOut,
    clear, drawGrid, drawAxes,
    drawCircle, drawPolyline, drawLine, drawText, drawScreenCircle
  }
}
