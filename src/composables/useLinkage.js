/**
 * 四连杆机构综合与动画状态管理。
 * Grashof 曲柄-摇杆物理仿真，支持多轮迭代优化。
 */
import { reactive, computed } from 'vue'
import { useTrajectory } from './useTrajectory.js'
import { optimizeLinkage, optimizeContinue } from '../engine/optimizer.js'
import { getLinkageState, computeCouplerCurve } from '../engine/fourbar.js'
import { centroid } from '../engine/geometry.js'

/** 预归一化参数：显示空间 ↔ 单位圆空间映射 */
let _normCenter = { x: 0, y: 0 }
let _normScale = 1  // 原始曲线 maxR；除以此值进入归一化空间，乘以退出

/** 将点集归一化到单位圆（质心原点，maxR=1） */
function normalizePoints(points) {
  const tc = centroid(points)
  let maxRSq = 0
  for (const p of points) { const d = (p.x - tc.x) ** 2 + (p.y - tc.y) ** 2; if (d > maxRSq) maxRSq = d }
  const maxR = Math.sqrt(maxRSq)
  if (maxR < 0.001) { _normCenter = { x: 0, y: 0 }; _normScale = 1; return points }
  _normCenter = tc; _normScale = maxR
  const s = 1 / maxR
  return points.map(p => ({ x: (p.x - tc.x) * s, y: (p.y - tc.y) * s }))
}

/** 点反归一化 */
function denormPoint(x, y) { return { x: x * _normScale + _normCenter.x, y: y * _normScale + _normCenter.y } }
/** 长度反归一化 */
function denormLen(l) { return l * _normScale }

const state = reactive({
  params: null, O2: null, O4: null, error: null,
  isOptimizing: false, progress: 0, statusMessage: '',
  isAnimating: false, animAngle: 0, speed: 1,
  currentState: null, couplerCurve: [], tracePoints: [], validRanges: [],
  round: 0,               // 优化轮次计数器
  targetError: null,       // 用户设定的目标最大误差
  autoIterating: false     // 自动迭代进行中标志
})

/**
 * 确保点列形成闭合环。
 * 首尾距离超过包围盒对角线 1.5% 时，自动追加首点闭合。
 * 返回新数组（不修改原始数据）。
 */
function ensureClosed(points) {
  if (points.length < 2) return points
  const first = points[0], last = points[points.length - 1]
  const gap = Math.sqrt((last.x - first.x) ** 2 + (last.y - first.y) ** 2)
  // 曲线跨度 = 包围盒对角线
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y
  }
  const diagonal = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2)
  if (diagonal < 0.001) return points  // 退化曲线
  // 间隙 < 对角线 1.5% → 视为已闭合
  if (gap / diagonal < 0.015) return points
  // 自动闭合：追加首点
  const closed = points.slice()
  closed.push({ x: first.x, y: first.y })
  return closed
}

export function useLinkage() {
  const trajectory = useTrajectory()

  const canOptimize = computed(() => trajectory.hasTrajectory.value && !state.isOptimizing)

  function reset() {
    state.params = null; state.O2 = null; state.O4 = null; state.error = null
    state.isOptimizing = false; state.progress = 0; state.isAnimating = false
    state.animAngle = 0; state.currentState = null; state.round = 0
    state.couplerCurve = []; state.tracePoints = []; state.validRanges = []
    state.statusMessage = ''; state.targetError = null; state.autoIterating = false
  }

  /** 应用优化结果：反归一化 → 写入状态 → 计算耦合曲线 */
  function applyResult(result) {
    const O2 = denormPoint(result.o2x, result.o2y)
    const O4 = denormPoint(result.o4x, result.o4y)
    state.O2 = O2; state.O4 = O4
    state.params = { a: denormLen(result.a), b: denormLen(result.b), c: denormLen(result.c), e: denormLen(result.e), beta: result.beta }
    state.error = result.error  // 误差无量纲
    state.statusMessage = `第${state.round}轮完成！误差: ${result.error.toFixed(4)}`
    trajectory.setAutoPivots(O2, O4)
    const curve = computeCouplerCurve({ ...state.params, O2, O4 }, 360)
    state.couplerCurve = curve.points.filter(p => p !== null).map(p => ({ x: p.x, y: p.y }))
    state.validRanges = curve.validRange
  }

  /** 第一轮优化：闭合 → 归一化 → DE + CD + Pivot 精修 */
  async function optimize() {
    if (!canOptimize.value) { state.statusMessage = '请先绘制一条轨迹曲线'; return }
    state.isOptimizing = true; state.progress = 0; state.round = 1
    state.statusMessage = '第1轮: 差分进化全局搜索...'
    state.params = null; state.error = null; state.O2 = null; state.O4 = null

    try {
      const closedPoints = ensureClosed(trajectory.state.points)
      if (closedPoints.length !== trajectory.state.points.length) {
        state.statusMessage = '第1轮: 轨迹已自动闭合 (首尾连接)'
      }
      const normalized = normalizePoints(closedPoints)
      const result = await optimizeLinkage(normalized, (p) => {
        state.progress = Math.round(p * 100)
        if (p < 0.70) state.statusMessage = `第1轮 DE全局搜索... ${Math.round(p * 100)}%`
        else state.statusMessage = `第1轮 坐标下降精修... ${Math.round(p * 100)}%`
      })
      if (result) {
        applyResult(result)
        // 若设定了目标误差且未达标，启动自动迭代
        if (state.targetError !== null && state.error > state.targetError) {
          await autoIterate()
        }
      }
      else state.statusMessage = '未找到可行解，请重试'
    } catch (e) { state.statusMessage = `出错: ${e.message}` }
    finally { state.isOptimizing = false }
  }

  /** 单轮继续优化核心。返回 true 表示误差有改进。 */
  async function _continueRound() {
    if (!state.params) return false
    state.isOptimizing = true; state.progress = 0; state.round++
    const r = state.round
    const prevError = state.error
    state.statusMessage = `第${r}轮: 在当前位置附近精细搜索...`

    try {
      // 将当前显示坐标参数归一化到单位圆空间
      const current = {
        o2x: (state.O2.x - _normCenter.x) / _normScale, o2y: (state.O2.y - _normCenter.y) / _normScale,
        o4x: (state.O4.x - _normCenter.x) / _normScale, o4y: (state.O4.y - _normCenter.y) / _normScale,
        a: state.params.a / _normScale, b: state.params.b / _normScale, c: state.params.c / _normScale,
        e: state.params.e / _normScale, beta: state.params.beta
      }
      const normalizedPts = normalizePoints(ensureClosed(trajectory.state.points))
      const result = await optimizeContinue(normalizedPts, current, (p) => {
        state.progress = Math.round(p * 100)
        state.statusMessage = `第${r}轮 精细搜索... ${Math.round(p * 100)}%`
      })
      if (result && result.error < prevError) {
        applyResult(result)
        state.round = r
        return true
      } else {
        state.statusMessage = `第${r}轮: 当前已是最优解 (误差 ${prevError.toFixed(4)})`
        state.round--
        return false
      }
    } catch (e) { state.statusMessage = `出错: ${e.message}`; state.round--; return false }
    finally { state.isOptimizing = false }
  }

  /** 手动继续优化（缩小搜索范围） */
  async function continueOptimize() {
    if (!state.params) { state.statusMessage = '请先运行第一轮优化'; return }
    if (state.isOptimizing) return
    await _continueRound()
  }

  /** 设定自动迭代目标误差阈值 */
  function setTargetError(val) {
    if (val === null || val === undefined || val === '' || isNaN(val) || val < 0) {
      state.targetError = null
    } else {
      state.targetError = Number(val)
    }
  }

  /** 取消自动迭代 */
  function cancelAutoIterate() {
    state.autoIterating = false
  }

  /** 自动迭代循环：直到误差达标或无法继续改进 */
  async function autoIterate() {
    state.autoIterating = true
    while (
      state.autoIterating &&
      state.params &&
      state.error !== null &&
      state.targetError !== null &&
      state.error > state.targetError
    ) {
      const improved = await _continueRound()
      if (!improved) break
      // 轮次间让出 UI 线程
      await new Promise(r => setTimeout(r, 30))
    }
    state.autoIterating = false
    if (!state.params) return
    if (state.error !== null && state.targetError !== null && state.error <= state.targetError) {
      state.statusMessage = `✅ 已达到目标误差! (≤ ${state.targetError.toFixed(4)})`
    } else if (state.error !== null && state.targetError !== null) {
      state.statusMessage = `⚠ 自动迭代停止: 无法进一步优化 (误差 ${state.error.toFixed(4)})`
    }
  }

  // ---- 动画（物理仿真：死点反转方向） ----

  let _direction = 1, _lastValidAngle = 0

  function startAnimation() {
    if (!state.params) { state.statusMessage = '请先运行优化'; return }
    state.isAnimating = true; state.animAngle = 0; state.tracePoints = []
    _direction = 1; _lastValidAngle = 0
    // 寻找有效起始角度
    for (let i = 0; i < 360; i++) {
      const a = (i / 360) * 2 * Math.PI
      if (getLinkageState({ ...state.params, O2: state.O2, O4: state.O4 }, a)) {
        state.animAngle = a; _lastValidAngle = a; break
      }
    }
  }
  function stopAnimation() { state.isAnimating = false }

  function tick(dt) {
    if (!state.isAnimating || !state.params) return
    const { O2, O4 } = state
    if (!O2 || !O4) return

    state.animAngle += _direction * (2 * Math.PI) / 3 * state.speed * dt

    const ls = getLinkageState({ ...state.params, O2, O4 }, state.animAngle)
    if (ls) {
      _lastValidAngle = state.animAngle
      state.currentState = ls
      state.tracePoints.push({ x: ls.P.x, y: ls.P.y })
      if (state.tracePoints.length > 2000) state.tracePoints = state.tracePoints.slice(-1000)
    } else {
      state.animAngle = _lastValidAngle
      _direction *= -1
    }
  }

  return { state, reset, canOptimize, optimize, continueOptimize, setTargetError, cancelAutoIterate, startAnimation, stopAnimation, tick }
}
