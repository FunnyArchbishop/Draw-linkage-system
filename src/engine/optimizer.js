/**
 * 四连杆机构轨迹综合——差分进化 + 坐标下降。
 * 序列感知误差度量（支持 8 字形等自交曲线）。
 * Grashof 约束、迭代多轮精修。
 */
import { centroid, resampleCurve, computePCA } from './geometry.js'
import { isAssemblable, isGrashofCrankRocker, computeCouplerCurve } from './fourbar.js'
import { computeDFT } from './fourier.js'

// 缓存目标曲线 k=1 谐波相位（buildBounds 时计算一次，evaluateError 复用）
let _cachedTargetPhase = 0

// ═══ 线段相交检测（自交判断） ═══

function cross(ax, ay, bx, by) { return ax * by - ay * bx }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y } }

function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = sub(p4, p3), d2 = sub(p1, p3), d3 = sub(p2, p3), d4 = sub(p2, p1), d5 = sub(p3, p1), d6 = sub(p4, p1)
  const c1 = cross(d1.x, d1.y, d2.x, d2.y), c2 = cross(d1.x, d1.y, d3.x, d3.y)
  const c3 = cross(d4.x, d4.y, d5.x, d5.y), c4 = cross(d4.x, d4.y, d6.x, d6.y)
  return (c1 * c2 < 0) && (c3 * c4 < 0)
}

function hasSelfIntersection(points) {
  const n = points.length
  if (n < 4) return false
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    for (let k = i + 2; k < n; k++) {
      const l = (k + 1) % n
      if (i === l || j === k) continue
      if (segmentsIntersect(points[i], points[j], points[k], points[l])) return true
    }
  }
  return false
}

// ═══ 误差评估 ═══

/**
 * 混合误差：60% 循环对齐序列误差 + 40% Chamfer 距离。
 * 序列误差保留点的顺序（对 8 字形等自交曲线至关重要）。
 */
function evaluateError(params, targetCurve, sampleCount = 200) {
  const { a, b, c, e, beta, O2, O4 } = params
  const gd = Math.sqrt((O4.x - O2.x) ** 2 + (O4.y - O2.y) ** 2)
  if (gd < 0.001 || !isAssemblable(a, b, c, gd)) return Infinity

  // Grashof 软惩罚：基于违反程度的 sigmoid（无硬性断崖）
  let grashofPenalty = 0
  if (!isGrashofCrankRocker(a, b, c, gd)) {
    const links = [a, b, c, gd]
    const shortest = Math.min(...links)
    const longest = Math.max(...links)
    const sumOthers = links.reduce((s, l) => s + l, 0) - shortest - longest
    // 不等式违反量: >0 表示非 Grashof（截断防止负奖励）
    const inequalityViolation = Math.max(0, (shortest + longest) - sumOthers)
    // 曲柄非最短杆的固定惩罚
    const crankViolation = Math.abs(a - shortest) < 1e-9 ? 0 : 0.25
    const scale = gd * 0.05 || 0.001
    // 边界处为 0 → 不等式部分最多 0.25 + 曲柄部分最多 0.25
    grashofPenalty = crankViolation + 0.25 * (1 - Math.exp(-inequalityViolation / scale))
  }

  const { points } = computeCouplerCurve({ a, b, c, e, beta, O2, O4 }, sampleCount)
  const valid = points.filter(p => p !== null && p.valid)
  if (valid.length < sampleCount * 0.5) return Infinity

  // 目标曲线已预归一化（单位圆，质心在原点）。
  // 候选曲线由归一化参数生成 → 同一坐标系 → 无需再次归一化。
  const nT = targetCurve
  const nC = valid.map(p => ({ x: p.x, y: p.y }))

  const N = Math.min(100, nT.length, nC.length)
  const tR = resampleCurve(nT, N), cR = resampleCurve(nC, N)

  // 循环对齐 RMS 误差（权重 60%）
  // DFT 引导：k=1 谐波相位差估算最佳偏移，±5 精确搜索替代跳跃采样
  let bestSeq = Infinity
  const candDFT = computeDFT(cR, 2)  // 仅 2 谐波，O(200) 可忽略
  const deltaPhase = _cachedTargetPhase - (candDFT.length > 1 ? candDFT[1].phase : 0)
  const estShift = Math.round((deltaPhase / (2 * Math.PI)) * N)
  const searchRadius = Math.min(5, Math.floor(N / 2) - 1)
  for (let s = estShift - searchRadius; s <= estShift + searchRadius; s++) {
    const shift = ((s % N) + N) % N  // 循环取模
    let sum = 0
    for (let i = 0; i < N; i++) {
      const ci = cR[(i + shift) % N]
      sum += (tR[i].x - ci.x) ** 2 + (tR[i].y - ci.y) ** 2
    }
    const rms = Math.sqrt(sum / N)
    if (rms < bestSeq) bestSeq = rms
  }

  // 形状覆盖度
  // Chamfer 距离（权重 40%）
  let sumTC = 0, sumCT = 0
  for (const tp of tR) {
    let minD = Infinity
    for (const cp of cR) { const d = (tp.x - cp.x) ** 2 + (tp.y - cp.y) ** 2; if (d < minD) minD = d }
    sumTC += Math.sqrt(minD)
  }
  for (const cp of cR) {
    let minD = Infinity
    for (const tp of tR) { const d = (cp.x - tp.x) ** 2 + (cp.y - tp.y) ** 2; if (d < minD) minD = d }
    sumCT += Math.sqrt(minD)
  }
  const chamfer = sumTC / N + sumCT / N

  return 0.6 * bestSeq + 0.4 * chamfer + grashofPenalty
}


function randRange(min, max) { return min + Math.random() * (max - min) }
function randInt(n) { return Math.floor(Math.random() * n) }

const KEYS = ['o2x', 'o2y', 'o4x', 'o4y', 'a', 'b', 'c', 'e', 'beta']

function toParams(v) {
  return { O2: { x: v.o2x, y: v.o2y }, O4: { x: v.o4x, y: v.o4y }, a: v.a, b: v.b, c: v.c, e: v.e, beta: v.beta }
}

/** 构建各参数搜索边界（PCA 收紧 O₂/O₄，DFT 辅助设定连杆范围） */
function buildBounds(targetCurve) {
  const tc = centroid(targetCurve)
  let maxR = 0
  for (const p of targetCurve) { const d = Math.sqrt((p.x - tc.x) ** 2 + (p.y - tc.y) ** 2); if (d > maxR) maxR = d }
  if (maxR === 0) maxR = 1

  const resampled = resampleCurve(targetCurve, 256)
  const coeffs = computeDFT(resampled, 3)
  const f1Amp = coeffs.length > 1 ? coeffs[1].amp : maxR * 0.3

  // 缓存 k=1 相位，供 evaluateError 中 DFT 引导对齐
  _cachedTargetPhase = coeffs.length > 1 ? coeffs[1].phase : 0

  // PCA 主轴方向用于收紧 pivot 搜索边界
  const pca = computePCA(resampled)

  // 自交检测
  const N = Math.min(100, targetCurve.length)
  const checkPts = resampleCurve(targetCurve, N)
  const selfIntersect = hasSelfIntersection(checkPts)

  // O2 边界：用 PCA 收紧（原始 maxR 为安全外廓）
  const o2xHalf = Math.min(maxR, pca.majorSpan * 0.6)
  const o2yHalf = Math.min(maxR, pca.majorSpan * 0.6)
  // O4 边界：允许沿主轴方向更远
  const o4xHalf = Math.min(maxR * 1.5, pca.majorSpan * 0.9)
  const o4yHalf = Math.min(maxR * 1.5, pca.majorSpan * 0.9)

  return {
    o2x: [tc.x - o2xHalf, tc.x + o2xHalf], o2y: [tc.y - o2yHalf, tc.y + o2yHalf],
    o4x: [tc.x - o4xHalf, tc.x + o4xHalf], o4y: [tc.y - o4yHalf, tc.y + o4yHalf],
    // 自交曲线：允许更短曲柄（8 字形需要不同比例）
    a: selfIntersect ? [maxR * 0.02, maxR * 0.4] : [maxR * 0.03, maxR * 0.5],
    b: [maxR * 0.2, maxR * 3.0], c: [maxR * 0.2, maxR * 3.0],
    e: [maxR * 0.05, maxR * 3.0], beta: [-Math.PI, Math.PI],
    maxR, f1Amp, centroid: tc, selfIntersect,
    pca  // 传递给 randomVector 偏置采样和 refinePivots
  }
}

/** 生成随机参数向量（含 PCA 偏置和自交启发式） */
function randomVector(bounds) {
  const v = {}; for (const k of KEYS) v[k] = randRange(bounds[k][0], bounds[k][1])

  // PCA 引导的 pivot 放置：约 35% 概率沿主轴对齐地面连杆
  if (bounds.pca && bounds.pca.majorSpan > 1e-6 && Math.random() < 0.35) {
    const { center, majorAxis, majorSpan, minorSpan } = bounds.pca
    // O₂ 置于主轴一端，O₄ 置于另一端
    const offset2 = majorSpan * randRange(0.15, 0.4)
    const offset4 = majorSpan * randRange(0.35, 0.7)
    const sign2 = Math.random() < 0.5 ? -1 : 1
    const sign4 = -sign2  // 质心两侧
    // 次轴方向的随机抖动
    const jitter2 = minorSpan * randRange(-0.3, 0.3)
    const jitter4 = minorSpan * randRange(-0.3, 0.3)
    v.o2x = center.x + majorAxis.dx * offset2 * sign2 + (-majorAxis.dy) * jitter2
    v.o2y = center.y + majorAxis.dy * offset2 * sign2 + majorAxis.dx * jitter2
    v.o4x = center.x + majorAxis.dx * offset4 * sign4 + (-majorAxis.dy) * jitter4
    v.o4y = center.y + majorAxis.dy * offset4 * sign4 + majorAxis.dx * jitter4
  }

  // 尝试对称连杆
  // 自交曲线启发式
  if (bounds.selfIntersect && Math.random() < 0.3) {
    v.a = randRange(bounds.a[0], bounds.a[1])
    v.c = v.a * randRange(0.8, 1.2)  // 近似对称曲柄与摇杆
    v.b = randRange(bounds.maxR * 1.0, bounds.maxR * 2.5) // 更长连杆
    v.e = randRange(bounds.maxR * 0.3, bounds.maxR * 1.5)
    v.beta = randRange(-Math.PI * 0.3, Math.PI * 0.3) // 小耦合角
  }
  return v
}

function clampVector(v, bounds) {
  const c = {}; for (const k of KEYS) c[k] = Math.max(bounds[k][0], Math.min(bounds[k][1], v[k])); return c
}

// 全局差分 ═══

function differentialEvolution(targetCurve, bounds, opts = {}) {
  const { NP = 80, generations = 100 } = opts
  let pop = [], fit = []
  for (let i = 0; i < NP; i++) { pop.push(randomVector(bounds)); fit.push(evaluateError(toParams(pop[i]), targetCurve)) }

  for (let gen = 0; gen < generations; gen++) {
    const Fg = 0.5 + Math.random() * 0.4
    for (let i = 0; i < NP; i++) {
      let a, b, c
      do { a = randInt(NP) } while (a === i)
      do { b = randInt(NP) } while (b === i || b === a)
      do { c = randInt(NP) } while (c === i || c === a || c === b)
      const trial = {}; const jRand = randInt(KEYS.length)
      for (let j = 0; j < KEYS.length; j++) {
        const k = KEYS[j]
        trial[k] = (Math.random() < 0.85 || j === jRand) ? pop[a][k] + Fg * (pop[b][k] - pop[c][k]) : pop[i][k]
      }
      const clamped = clampVector(trial, bounds)
      const err = evaluateError(toParams(clamped), targetCurve)
      if (err < fit[i]) { pop[i] = clamped; fit[i] = err }
    }
  }
  return pop.map((v, i) => ({ ...v, error: fit[i] })).sort((a, b) => a.error - b.error)
}

// 坐标下降 ═══

function coordinateDescent(candidate, targetCurve, bounds, maxIter = 400) {
  let best = { ...candidate }
  let bestErr = evaluateError(toParams(best), targetCurve)
  if (!isFinite(bestErr)) return { ...best, error: bestErr }

  /** 单次 CD 运行：从起始点沿坐标轴贪婪下降 */
  function runCD(start, iterations) {
    let cur = { ...start }
    let curErr = evaluateError(toParams(cur), targetCurve)
    if (!isFinite(curErr)) return { point: cur, error: curErr }

    const deltas = {}
    for (const k of KEYS) deltas[k] = k === 'beta' ? 0.15 : (Math.abs(cur[k]) * 0.06 || 0.005)

    for (let iter = 0; iter < iterations; iter++) {
      let improved = false
      // 每轮随机打乱参数顺序——消除方向偏置
      const order = [...KEYS].sort(() => Math.random() - 0.5)
      for (const k of order) {
        for (const sign of [-1, 1]) {
          const trial = { ...cur }; trial[k] += sign * deltas[k]
          const clamped = clampVector(trial, bounds)
          const err = evaluateError(toParams(clamped), targetCurve)
          if (err < curErr) { cur = clamped; curErr = err; improved = true; deltas[k] *= 1.4 }
        }
      }
      if (!improved) { for (const k of KEYS) deltas[k] *= 0.4 }
      if (Math.max(...KEYS.map(k => deltas[k])) < 1e-9) break
    }
    return { point: cur, error: curErr }
  }

  // 主运行
  let result = runCD(best, maxIter)
  best = result.point; bestErr = result.error

  // 扰动跳出浅层局部最优
  for (let attempt = 0; attempt < 2; attempt++) {
    if (bestErr < 0.01) break  // 已足够好，跳过

    // 对当前最优解施加 ±15% 随机扰动
    const perturbed = {}
    for (const k of KEYS) {
      const delta = Math.abs(best[k]) * 0.15 || (bounds.maxR || 1) * 0.02
      perturbed[k] = best[k] + (Math.random() - 0.5) * 2 * delta
    }
    const clamped = clampVector(perturbed, bounds)
    const pErr = evaluateError(toParams(clamped), targetCurve)
    if (!isFinite(pErr) || pErr > bestErr * 5) continue  // 退化太严重，跳过

    result = runCD(clamped, Math.floor(maxIter / 2))
    if (result.error < bestErr) { best = result.point; bestErr = result.error }
  }

  return { ...best, error: bestErr }
}

// Pivot 精修（固参搜索）

const PIVOT_KEYS = ['o2x', 'o2y', 'o4x', 'o4y']

/**
 * 固定连杆尺寸，仅精修 O₂/O₄ 位置。
 * 步长为 2%（vs 主 CD 的 6%），更精细搜索。
 */
function refinePivots(targetCurve, candidate, bounds, maxIter = 200) {
  let best = { ...candidate }
  let bestErr = candidate.error ?? evaluateError(toParams(best), targetCurve)
  if (!isFinite(bestErr)) return best

  // 更小步长：当前值的 2%（主 CD 为 6%）
  const deltas = {}
  for (const k of PIVOT_KEYS) {
    deltas[k] = Math.abs(best[k]) * 0.02 || bounds.maxR * 0.005
  }

  // 固定非 pivot 参数的特殊截断函数
  function pivotClamp(trial) {
    const c = {}
    for (const k of KEYS) {
      if (PIVOT_KEYS.includes(k)) {
        c[k] = Math.max(bounds[k]?.[0] ?? -Infinity, Math.min(bounds[k]?.[1] ?? Infinity, trial[k]))
      } else {
        c[k] = best[k]  // 固定不变
      }
    }
    return c
  }

  for (let iter = 0; iter < maxIter; iter++) {
    let improved = false
    for (const k of PIVOT_KEYS) {
      for (const sign of [-1, 1]) {
        const trial = { ...best }
        trial[k] += sign * deltas[k]
        const clamped = pivotClamp(trial)
        const err = evaluateError(toParams(clamped), targetCurve)
        if (err < bestErr) {
          best = clamped
          bestErr = err
          improved = true
          deltas[k] *= 1.4
        }
      }
    }
    if (!improved) {
      // 所有 pivot 步长同步缩小
      for (const k of PIVOT_KEYS) deltas[k] *= 0.35
    }
    if (Math.max(...PIVOT_KEYS.map(k => deltas[k])) < 1e-9) break
  }

  return { ...best, error: bestErr }
}

// ═══ 导出 API ═══

/** 第一轮优化：DE 全局搜索 → CD 精修 → Pivot 精修 */
export async function optimizeLinkage(targetCurve, onProgress) {
  if (targetCurve.length < 10) return null
  const bounds = buildBounds(targetCurve)

  // 自交曲线增加迭代代数
  const extraGens = bounds.selfIntersect ? 40 : 0
  if (onProgress) onProgress(0.02)

  const deResults = differentialEvolution(targetCurve, bounds, { NP: 80, generations: 100 + extraGens })
  const topN = deResults.slice(0, 12)
  if (onProgress) onProgress(0.70)
  if (topN.length === 0) return null

  const refined = []
  for (let i = 0; i < topN.length; i++) {
    const cd = coordinateDescent(topN[i], targetCurve, bounds, bounds.selfIntersect ? 500 : 400)
    refined.push(refinePivots(targetCurve, cd, bounds))
    if (onProgress) onProgress(0.70 + ((i + 1) / topN.length) * 0.30)
    await new Promise(r => setTimeout(r, 0))
  }
  refined.sort((a, b) => a.error - b.error)
  return refined[0]
}

/** 后续轮次：在当前位置缩小边界重新搜索 */
export async function optimizeContinue(targetCurve, current, onProgress) {
  const fullBounds = buildBounds(targetCurve)
  const shrink = 0.3
  const bounds = {}
  for (const k of KEYS) {
    if (k === 'beta') { bounds[k] = [current[k] - 0.5, current[k] + 0.5] }
    else { const r = Math.abs(current[k]) * shrink || fullBounds.maxR * 0.1; bounds[k] = [current[k] - r, current[k] + r] }
  }
  for (const k of ['a', 'b', 'c', 'e']) bounds[k][0] = Math.max(0.0001, bounds[k][0])
  // 保留自交标志和启发式参数
  bounds.selfIntersect = fullBounds.selfIntersect; bounds.maxR = fullBounds.maxR

  if (onProgress) onProgress(0.05)

  const NP = 40, G = 60
  let pop = [], fit = []
  for (let i = 0; i < NP; i++) { pop.push(randomVector(bounds)); fit.push(evaluateError(toParams(pop[i]), targetCurve)) }
  pop[0] = { ...current }; fit[0] = evaluateError(toParams(current), targetCurve)

  for (let gen = 0; gen < G; gen++) {
    const Fg = 0.4 + Math.random() * 0.3
    for (let i = 0; i < NP; i++) {
      let a, b, c
      do { a = randInt(NP) } while (a === i)
      do { b = randInt(NP) } while (b === i || b === a)
      do { c = randInt(NP) } while (c === i || c === a || c === b)
      const trial = {}; const jRand = randInt(KEYS.length)
      for (let j = 0; j < KEYS.length; j++) {
        const k = KEYS[j]
        trial[k] = (Math.random() < 0.8 || j === jRand) ? pop[a][k] + Fg * (pop[b][k] - pop[c][k]) : pop[i][k]
      }
      const clamped = clampVector(trial, bounds)
      const err = evaluateError(toParams(clamped), targetCurve)
      if (err < fit[i]) { pop[i] = clamped; fit[i] = err }
    }
    if (onProgress && gen % 10 === 0) onProgress(0.05 + (gen / G) * 0.55)
  }

  if (onProgress) onProgress(0.60)
  const ranked = pop.map((v, i) => ({ ...v, error: fit[i] })).sort((a, b) => a.error - b.error)
  const topN = ranked.slice(0, 8)

  const refined = []
  for (let i = 0; i < topN.length; i++) {
    const cd = coordinateDescent(topN[i], targetCurve, bounds, 300)
    refined.push(refinePivots(targetCurve, cd, bounds))
    if (onProgress) onProgress(0.60 + ((i + 1) / topN.length) * 0.40)
    await new Promise(r => setTimeout(r, 0))
  }
  refined.sort((a, b) => a.error - b.error)
  return refined[0]
}
