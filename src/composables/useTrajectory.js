/**
 * 轨迹状态管理——数据中心枢纽。
 * Pivot 位置由优化器自动计算，非手动选取。
 */
import { reactive, computed } from 'vue'
import { cartesianToPolar, centroid, resampleCurve } from '../engine/geometry.js'

const state = reactive({
  /** @type {Array<{x: number, y: number}>} 原始手绘点 */
  points: [],
  /** @type {{x: number, y: number} | null} 自动计算的地面枢轴 O₂ */
  pivotO2: null,
  /** @type {{x: number, y: number} | null} 自动计算的地面枢轴 O₄ */
  pivotO4: null,
  /** @type {{x: number, y: number} | null} 自动计算的地面枢轴 O₆（六杆用） */
  pivotO6: null,
  /** @type {boolean} 用户是否正在绘制 */
  isDrawing: false
})

export function useTrajectory() {
  /** 追加轨迹点 */
  function addPoint(x, y) {
    state.points.push({ x, y })
  }

  /** 开始一笔绘制 */
  function startStroke() {
    state.isDrawing = true
  }

  /** 结束一笔绘制 */
  function endStroke() {
    state.isDrawing = false
  }

  /** 清空所有轨迹 */
  function clearPoints() {
    state.points = []
    state.pivotO2 = null
    state.pivotO4 = null
    state.pivotO6 = null
  }

  /** 设置自动计算的 Pivot 位置（优化器调用） */
  function setAutoPivots(O2, O4, O6 = null) {
    state.pivotO2 = O2 ? { x: O2.x, y: O2.y } : null
    state.pivotO4 = O4 ? { x: O4.x, y: O4.y } : null
    state.pivotO6 = O6 ? { x: O6.x, y: O6.y } : null
  }

  const pointCount = computed(() => state.points.length)

  const hasTrajectory = computed(() => state.points.length >= 3)

  const resampledPoints = computed(() => {
    if (state.points.length < 3) return []
    return resampleCurve(state.points, 256)
  })

  const trajectoryCentroid = computed(() => centroid(state.points))

  const polarPoints = computed(() => {
    const c = trajectoryCentroid.value
    return state.points.map(p => {
      const polar = cartesianToPolar(p.x, p.y, c.x, c.y)
      return {
        x: p.x, y: p.y,
        r: polar.r, theta: polar.theta,
        thetaDeg: (polar.theta * 180) / Math.PI
      }
    })
  })

  return {
    state,
    addPoint,
    startStroke,
    endStroke,
    clearPoints,
    setAutoPivots,
    pointCount,
    hasTrajectory,
    resampledPoints,
    trajectoryCentroid,
    polarPoints
  }
}
