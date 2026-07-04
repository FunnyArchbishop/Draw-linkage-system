/**
 * 多连杆机构综合与动画状态管理。
 * 支持四杆/六杆瓦特I型/六杆斯蒂芬森I型。
 * Grashof 曲柄-摇杆物理仿真，递进式优化策略。
 */
import { reactive, computed } from 'vue'
import { useTrajectory } from './useTrajectory.js'
import { optimizeLinkage, optimizeContinue, upgradeFourBarToSixBar } from '../engine/optimizer.js'
import { computeCouplerCurveMulti, solveLinkage, LINKAGE_TYPES } from '../engine/multibar.js'
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
  /** 当前连杆类型 */
  linkageType: LINKAGE_TYPES.FOUR_BAR,
  /** 优化结果原始参数（flat key-value 格式） */
  params: null,
  /** 各枢轴位置 */
  O2: null, O4: null, O6: null,
  /** 子回路参数（用于显示） */
  subLinkages: [],
  error: null,
  isOptimizing: false, progress: 0, statusMessage: '',
  isAnimating: false, animAngle: 0, speed: 1,
  currentState: null, couplerCurve: [], tracePoints: [], validRanges: [],
  round: 0,
  targetError: null,
  autoIterating: false,
  /** 递进优化：四杆结果暂存（升级六杆用） */
  _fourBarResult: null
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
    state.params = null; state.O2 = null; state.O4 = null; state.O6 = null
    state.isOptimizing = false; state.progress = 0; state.isAnimating = false
    state.animAngle = 0; state.currentState = null; state.round = 0
    state.couplerCurve = []; state.tracePoints = []; state.validRanges = []
    state.statusMessage = ''; state.targetError = null; state.autoIterating = false
    state.subLinkages = []; state._fourBarResult = null
  }

  /** 设置连杆类型 */
  function setLinkageType(type) {
    if (state.isOptimizing) return
    state.linkageType = type
    // 切换类型时清除旧结果
    reset()
  }

  /** 应用优化结果：反归一化 → 写入状态 → 计算耦合曲线 */
  function applyResult(result) {
    const lt = result.linkageType || LINKAGE_TYPES.FOUR_BAR
    state.linkageType = lt

    const O2 = denormPoint(result.o2x, result.o2y)
    const O4 = denormPoint(result.o4x, result.o4y)
    state.O2 = O2; state.O4 = O4

    if (lt === LINKAGE_TYPES.FOUR_BAR) {
      state.O6 = null
      state.params = {
        a: denormLen(result.a), b: denormLen(result.b), c: denormLen(result.c),
        e: denormLen(result.e), beta: result.beta
      }
      state.subLinkages = [{
        name: '主回路', O2, O4,
        a: denormLen(result.a), b: denormLen(result.b), c: denormLen(result.c),
        e: denormLen(result.e), beta: result.beta
      }]
    } else {
      state.O6 = denormPoint(result.o6x, result.o6y)
      state.params = {
        a1: denormLen(result.a1), b1: denormLen(result.b1), c1: denormLen(result.c1),
        a2: denormLen(result.a2), b2: denormLen(result.b2), c2: denormLen(result.c2),
        lBd: denormLen(result.lBd), phiBd: result.phiBd
      }
      if (lt === LINKAGE_TYPES.WATT_I) {
        state.params.e2 = denormLen(result.e2)
        state.params.beta2 = result.beta2
      } else {
        state.params.lDe = denormLen(result.lDe)
        state.params.phiDe = result.phiDe
      }
      state.subLinkages = [
        {
          name: '回路1 (O2-O4)', O2, O4,
          a: denormLen(result.a1), b: denormLen(result.b1), c: denormLen(result.c1)
        },
        {
          name: '回路2 (O4-O6)', O4: O4, O6: state.O6,
          a: denormLen(result.a2), b: denormLen(result.b2), c: denormLen(result.c2)
        }
      ]
    }

    state.error = result.error
    state.statusMessage = `第${state.round}轮完成！误差: ${result.error.toFixed(4)}`

    // 更新 Pivot 显示
    trajectory.setAutoPivots(O2, O4, state.O6)

    // 计算耦合曲线
    const flatParams = buildFlatParams(lt, result)
    const curve = computeCouplerCurveMulti(lt, flatParams, 360)
    state.couplerCurve = curve.points.filter(p => p !== null).map(p => ({ x: p.x, y: p.y }))
    state.validRanges = curve.validRange
  }

  /** 从 flat result 构建多连杆求解所需的扁平参数 */
  function buildFlatParams(lt, result) {
    if (lt === LINKAGE_TYPES.FOUR_BAR) {
      return {
        o2x: denormPoint(result.o2x, result.o2y).x,
        o2y: denormPoint(result.o2x, result.o2y).y,
        o4x: denormPoint(result.o4x, result.o4y).x,
        o4y: denormPoint(result.o4x, result.o4y).y,
        a: denormLen(result.a), b: denormLen(result.b), c: denormLen(result.c),
        e: denormLen(result.e), beta: result.beta
      }
    }
    const O2 = denormPoint(result.o2x, result.o2y)
    const O4 = denormPoint(result.o4x, result.o4y)
    const O6 = denormPoint(result.o6x, result.o6y)
    const base = {
      o2x: O2.x, o2y: O2.y,
      o4x: O4.x, o4y: O4.y,
      o6x: O6.x, o6y: O6.y,
      a1: denormLen(result.a1), b1: denormLen(result.b1), c1: denormLen(result.c1),
      a2: denormLen(result.a2), b2: denormLen(result.b2), c2: denormLen(result.c2),
      lBd: denormLen(result.lBd), phiBd: result.phiBd
    }
    if (lt === LINKAGE_TYPES.WATT_I) {
      base.e2 = denormLen(result.e2); base.beta2 = result.beta2
    } else {
      base.lDe = denormLen(result.lDe); base.phiDe = result.phiDe
    }
    return base
  }

  /** 第一轮优化：闭合 → 归一化 → DE + CD + Pivot 精修 */
  async function optimize() {
    if (!canOptimize.value) { state.statusMessage = '请先绘制一条轨迹曲线'; return }
    state.isOptimizing = true; state.progress = 0; state.round = 1
    const lt = state.linkageType
    state.statusMessage = `第1轮: 差分进化全局搜索...`
    state.params = null; state.error = null; state.O2 = null; state.O4 = null; state.O6 = null
    state._fourBarResult = null

    try {
      const closedPoints = ensureClosed(trajectory.state.points)
      if (closedPoints.length !== trajectory.state.points.length) {
        state.statusMessage = `第1轮: 轨迹已自动闭合 (首尾连接)`
      }
      const normalized = normalizePoints(closedPoints)

      // 递进式优化：六杆机构先跑四杆快速收敛，再升级
      let result
      if (lt !== LINKAGE_TYPES.FOUR_BAR && !state._fourBarResult) {
        state.statusMessage = `第1轮: 阶段1/2 四杆预优化...`
        const fbResult = await optimizeLinkage(LINKAGE_TYPES.FOUR_BAR, normalized, (p) => {
          state.progress = Math.round(p * 40)
          state.statusMessage = `第1轮: 阶段1/2 四杆预优化 ${Math.round(p * 100)}%`
        })
        if (fbResult) {
          state._fourBarResult = fbResult
          state.statusMessage = `第1轮: 阶段2/2 六杆全局搜索...`
          // 将四杆结果升级为六杆初始种子
          const seed = upgradeFourBarToSixBar(fbResult, lt)
          result = await optimizeLinkage(lt, normalized, (p) => {
            state.progress = Math.round(40 + p * 60)
            if (p < 0.7) state.statusMessage = `第1轮: 六杆搜索 ${Math.round(p * 100)}%`
            else state.statusMessage = `第1轮: 六杆精修 ${Math.round(p * 100)}%`
          }, seed)
        } else {
          state.statusMessage = '四杆预优化失败，请重绘轨迹'
          state.isOptimizing = false
          return
        }
      } else {
        result = await optimizeLinkage(lt, normalized, (p) => {
          state.progress = Math.round(p * 100)
          if (p < 0.70) state.statusMessage = `第1轮: DE全局搜索... ${Math.round(p * 100)}%`
          else state.statusMessage = `第1轮: 坐标下降精修... ${Math.round(p * 100)}%`
        })
      }

      if (result) {
        applyResult(result)
        if (state.targetError !== null && state.error > state.targetError) {
          await autoIterate()
        }
      }
      else state.statusMessage = '未找到可行解，请重试或切换连杆类型'
    } catch (e) { state.statusMessage = `出错: ${e.message}` }
    finally { state.isOptimizing = false }
  }

  /** 单轮继续优化核心。返回 true 表示误差有改进。 */
  async function _continueRound() {
    if (!state.params) return false
    state.isOptimizing = true; state.progress = 0; state.round++
    const r = state.round
    const lt = state.linkageType
    const prevError = state.error
    state.statusMessage = `第${r}轮: 在当前位置附近精细搜索...`

    try {
      const current = buildNormParams(lt)
      const normalizedPts = normalizePoints(ensureClosed(trajectory.state.points))
      const result = await optimizeContinue(lt, normalizedPts, current, (p) => {
        state.progress = Math.round(p * 100)
        state.statusMessage = `第${r}轮: 精细搜索... ${Math.round(p * 100)}%`
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

  /** 将当前显示参数归一化到单位圆空间 */
  function buildNormParams(lt) {
    if (lt === LINKAGE_TYPES.FOUR_BAR) {
      return {
        o2x: (state.O2.x - _normCenter.x) / _normScale,
        o2y: (state.O2.y - _normCenter.y) / _normScale,
        o4x: (state.O4.x - _normCenter.x) / _normScale,
        o4y: (state.O4.y - _normCenter.y) / _normScale,
        a: state.params.a / _normScale, b: state.params.b / _normScale,
        c: state.params.c / _normScale, e: state.params.e / _normScale,
        beta: state.params.beta
      }
    }
    const base = {
      o2x: (state.O2.x - _normCenter.x) / _normScale,
      o2y: (state.O2.y - _normCenter.y) / _normScale,
      o4x: (state.O4.x - _normCenter.x) / _normScale,
      o4y: (state.O4.y - _normCenter.y) / _normScale,
      o6x: (state.O6.x - _normCenter.x) / _normScale,
      o6y: (state.O6.y - _normCenter.y) / _normScale,
      a1: state.params.a1 / _normScale, b1: state.params.b1 / _normScale,
      c1: state.params.c1 / _normScale, a2: state.params.a2 / _normScale,
      b2: state.params.b2 / _normScale, c2: state.params.c2 / _normScale,
      lBd: state.params.lBd / _normScale, phiBd: state.params.phiBd
    }
    if (lt === LINKAGE_TYPES.WATT_I) {
      base.e2 = state.params.e2 / _normScale; base.beta2 = state.params.beta2
    } else {
      base.lDe = state.params.lDe / _normScale; base.phiDe = state.params.phiDe
    }
    return base
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
    const lt = state.linkageType
    for (let i = 0; i < 360; i++) {
      const a = (i / 360) * 2 * Math.PI
      const flatParams = buildAnimParams()
      if (solveLinkage(lt, flatParams, a)) {
        state.animAngle = a; _lastValidAngle = a; break
      }
    }
  }
  function stopAnimation() { state.isAnimating = false }

  /** 构建动画用的扁平参数（反归一化后的世界坐标） */
  function buildAnimParams() {
    const lt = state.linkageType
    if (lt === LINKAGE_TYPES.FOUR_BAR) {
      return {
        o2x: state.O2.x, o2y: state.O2.y,
        o4x: state.O4.x, o4y: state.O4.y,
        a: state.params.a, b: state.params.b, c: state.params.c,
        e: state.params.e, beta: state.params.beta
      }
    }
    const base = {
      o2x: state.O2.x, o2y: state.O2.y,
      o4x: state.O4.x, o4y: state.O4.y,
      o6x: state.O6.x, o6y: state.O6.y,
      a1: state.params.a1, b1: state.params.b1, c1: state.params.c1,
      a2: state.params.a2, b2: state.params.b2, c2: state.params.c2,
      lBd: state.params.lBd, phiBd: state.params.phiBd
    }
    if (lt === LINKAGE_TYPES.WATT_I) {
      base.e2 = state.params.e2; base.beta2 = state.params.beta2
    } else {
      base.lDe = state.params.lDe; base.phiDe = state.params.phiDe
    }
    return base
  }

  function tick(dt) {
    if (!state.isAnimating || !state.params) return
    const lt = state.linkageType
    const O2 = state.O2
    if (!O2) return

    state.animAngle += _direction * (2 * Math.PI) / 3 * state.speed * dt

    const flatParams = buildAnimParams()
    const ls = solveLinkage(lt, flatParams, state.animAngle)
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

  return {
    state, reset, canOptimize, optimize, continueOptimize,
    setTargetError, cancelAutoIterate, startAnimation, stopAnimation, tick,
    setLinkageType
  }
}
