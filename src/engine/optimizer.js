/**
 * 多连杆机构轨迹综合——差分进化 + 坐标下降。
 * 支持四杆/六杆瓦特I型/六杆斯蒂芬森I型。
 * 序列感知误差度量（支持 8 字形等自交曲线）。
 * Grashof 约束、迭代多轮精修、递进式优化策略。
 */
import { centroid, resampleCurve, computePCA } from './geometry.js'
import { computeDFT } from './fourier.js'
import {
  LINKAGE_TYPES,
  getParamKeys,
  isMultiBarAssemblable,
  isMultiBarGrashof,
  computeCouplerCurveMulti
} from './multibar.js'

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
 * 通用误差评估（多连杆）。
 * 混合误差：60% 循环对齐序列误差 + 40% Chamfer 距离。
 */
function evaluateErrorMulti(linkageType, params, targetCurve, sampleCount = 200) {
  // 可装配性检查
  if (!isMultiBarAssemblable(linkageType, params)) return Infinity

  // Grashof 软惩罚
  let grashofPenalty = 0
  if (!isMultiBarGrashof(linkageType, params)) {
    const pk = getParamKeys(linkageType)
    const pivotKeys = pk.pivots
    const o2x = params[pivotKeys[0]], o2y = params[pivotKeys[1]]
    const o4x = params[pivotKeys[2]], o4y = params[pivotKeys[3]]
    const gd = Math.sqrt((o4x - o2x) ** 2 + (o4y - o2y) ** 2)

    const isFourBar = linkageType === LINKAGE_TYPES.FOUR_BAR
    const aKey = isFourBar ? 'a' : 'a1'
    const bKey = isFourBar ? 'b' : 'b1'
    const cKey = isFourBar ? 'c' : 'c1'
    const a = params[aKey], b = params[bKey], c = params[cKey]

    const links = [a, b, c, gd]
    const shortest = Math.min(...links)
    const longest = Math.max(...links)
    const sumOthers = links.reduce((s, l) => s + l, 0) - shortest - longest
    const inequalityViolation = Math.max(0, (shortest + longest) - sumOthers)
    const crankViolation = Math.abs(a - shortest) < 1e-9 ? 0 : 0.25
    const scale = gd * 0.05 || 0.001
    grashofPenalty = crankViolation + 0.25 * (1 - Math.exp(-inequalityViolation / scale))
  }

  const { points } = computeCouplerCurveMulti(linkageType, params, sampleCount)
  const valid = points.filter(p => p !== null && p.valid)
  if (valid.length < sampleCount * 0.5) return Infinity

  const nT = targetCurve
  const nC = valid.map(p => ({ x: p.x, y: p.y }))

  const N = Math.min(100, nT.length, nC.length)
  const tR = resampleCurve(nT, N), cR = resampleCurve(nC, N)

  // 循环对齐 RMS 误差（权重 60%）
  let bestSeq = Infinity
  const candDFT = computeDFT(cR, 2)
  const deltaPhase = _cachedTargetPhase - (candDFT.length > 1 ? candDFT[1].phase : 0)
  const estShift = Math.round((deltaPhase / (2 * Math.PI)) * N)
  const searchRadius = Math.min(5, Math.floor(N / 2) - 1)
  for (let s = estShift - searchRadius; s <= estShift + searchRadius; s++) {
    const shift = ((s % N) + N) % N
    let sum = 0
    for (let i = 0; i < N; i++) {
      const ci = cR[(i + shift) % N]
      sum += (tR[i].x - ci.x) ** 2 + (tR[i].y - ci.y) ** 2
    }
    const rms = Math.sqrt(sum / N)
    if (rms < bestSeq) bestSeq = rms
  }

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

/** 构建搜索边界（多连杆通用） */
function buildBoundsMulti(linkageType, targetCurve) {
  const tc = centroid(targetCurve)
  let maxR = 0
  for (const p of targetCurve) { const d = Math.sqrt((p.x - tc.x) ** 2 + (p.y - tc.y) ** 2); if (d > maxR) maxR = d }
  if (maxR === 0) maxR = 1

  const resampled = resampleCurve(targetCurve, 256)
  const coeffs = computeDFT(resampled, 3)
  const f1Amp = coeffs.length > 1 ? coeffs[1].amp : maxR * 0.3
  _cachedTargetPhase = coeffs.length > 1 ? coeffs[1].phase : 0

  const pca = computePCA(resampled)

  const N = Math.min(100, targetCurve.length)
  const checkPts = resampleCurve(targetCurve, N)
  const selfIntersect = hasSelfIntersection(checkPts)

  const o2xHalf = Math.min(maxR, pca.majorSpan * 0.6)
  const o2yHalf = Math.min(maxR, pca.majorSpan * 0.6)
  const o4xHalf = Math.min(maxR * 1.5, pca.majorSpan * 0.9)
  const o4yHalf = Math.min(maxR * 1.5, pca.majorSpan * 0.9)

  const isFourBar = linkageType === LINKAGE_TYPES.FOUR_BAR

  const bounds = {
    o2x: [tc.x - o2xHalf, tc.x + o2xHalf], o2y: [tc.y - o2yHalf, tc.y + o2yHalf],
    o4x: [tc.x - o4xHalf, tc.x + o4xHalf], o4y: [tc.y - o4yHalf, tc.y + o4yHalf],
    maxR, f1Amp, centroid: tc, selfIntersect, pca
  }

  if (isFourBar) {
    bounds.a = selfIntersect ? [maxR * 0.02, maxR * 0.4] : [maxR * 0.03, maxR * 0.5]
    bounds.b = [maxR * 0.2, maxR * 3.0]; bounds.c = [maxR * 0.2, maxR * 3.0]
    bounds.e = [maxR * 0.05, maxR * 3.0]; bounds.beta = [-Math.PI, Math.PI]
  } else {
    // 六杆机构边界
    const o6xHalf = Math.min(maxR * 2.0, pca.majorSpan * 1.2)
    const o6yHalf = Math.min(maxR * 2.0, pca.majorSpan * 1.2)
    bounds.o6x = [tc.x - o6xHalf, tc.x + o6xHalf]
    bounds.o6y = [tc.y - o6yHalf, tc.y + o6yHalf]

    // 回路1
    bounds.a1 = selfIntersect ? [maxR * 0.02, maxR * 0.4] : [maxR * 0.03, maxR * 0.5]
    bounds.b1 = [maxR * 0.2, maxR * 3.0]; bounds.c1 = [maxR * 0.2, maxR * 3.0]
    // 回路2
    bounds.a2 = [maxR * 0.02, maxR * 0.6]
    bounds.b2 = [maxR * 0.15, maxR * 3.0]; bounds.c2 = [maxR * 0.15, maxR * 3.0]

    // 耦合参数
    bounds.lBd = [maxR * 0.1, maxR * 2.5]
    bounds.phiBd = [-Math.PI, Math.PI]

    if (linkageType === LINKAGE_TYPES.WATT_I) {
      bounds.e2 = [maxR * 0.05, maxR * 3.0]
      bounds.beta2 = [-Math.PI, Math.PI]
    } else {
      bounds.lDe = [maxR * 0.05, maxR * 2.0]
      bounds.phiDe = [-Math.PI, Math.PI]
    }
  }

  return bounds
}

/** 生成随机参数向量 */
function randomVectorMulti(linkageType, bounds) {
  const pk = getParamKeys(linkageType)
  const KEYS = pk.all
  const v = {}
  for (const k of KEYS) v[k] = randRange(bounds[k][0], bounds[k][1])

  const isFourBar = linkageType === LINKAGE_TYPES.FOUR_BAR

  // PCA 引导的 pivot 放置
  if (bounds.pca && bounds.pca.majorSpan > 1e-6 && Math.random() < 0.35) {
    const { center, majorAxis, majorSpan, minorSpan } = bounds.pca
    const offset2 = majorSpan * randRange(0.15, 0.4)
    const offset4 = majorSpan * randRange(0.35, 0.7)
    const sign2 = Math.random() < 0.5 ? -1 : 1
    const sign4 = -sign2
    const jitter2 = minorSpan * randRange(-0.3, 0.3)
    const jitter4 = minorSpan * randRange(-0.3, 0.3)
    v.o2x = center.x + majorAxis.dx * offset2 * sign2 + (-majorAxis.dy) * jitter2
    v.o2y = center.y + majorAxis.dy * offset2 * sign2 + majorAxis.dx * jitter2
    v.o4x = center.x + majorAxis.dx * offset4 * sign4 + (-majorAxis.dy) * jitter4
    v.o4y = center.y + majorAxis.dy * offset4 * sign4 + majorAxis.dx * jitter4

    // O6 置于 O4 延长方向
    if (!isFourBar && bounds.o6x) {
      const offset6 = majorSpan * randRange(0.5, 0.9)
      const sign6 = sign4
      v.o6x = center.x + majorAxis.dx * offset6 * sign6 + (-majorAxis.dy) * minorSpan * randRange(-0.2, 0.2)
      v.o6y = center.y + majorAxis.dy * offset6 * sign6 + majorAxis.dx * minorSpan * randRange(-0.2, 0.2)
    }
  }

  // 自交启发式
  if (bounds.selfIntersect && Math.random() < 0.3) {
    if (isFourBar) {
      v.a = randRange(bounds.a[0], bounds.a[1])
      v.c = v.a * randRange(0.8, 1.2)
      v.b = randRange(bounds.maxR * 1.0, bounds.maxR * 2.5)
      v.e = randRange(bounds.maxR * 0.3, bounds.maxR * 1.5)
      v.beta = randRange(-Math.PI * 0.3, Math.PI * 0.3)
    } else {
      v.a1 = randRange(bounds.a1[0], bounds.a1[1])
      v.c1 = v.a1 * randRange(0.8, 1.2)
      v.b1 = randRange(bounds.maxR * 1.0, bounds.maxR * 2.5)
      v.a2 = v.a1 * randRange(0.6, 1.4)
      v.c2 = v.a2 * randRange(0.8, 1.2)
      v.b2 = randRange(bounds.maxR * 0.8, bounds.maxR * 2.0)
    }
  }
  return v
}

/** 参数截断到边界 */
function clampVectorMulti(linkageType, v, bounds) {
  const pk = getParamKeys(linkageType)
  const c = {}
  for (const k of pk.all) c[k] = Math.max(bounds[k][0], Math.min(bounds[k][1], v[k]))
  return c
}

// ═══ 差分进化 ═══

function differentialEvolutionMulti(linkageType, targetCurve, bounds, opts = {}) {
  const pk = getParamKeys(linkageType)
  const KEYS = pk.all
  const { NP = 80, generations = 100, seeds = [] } = opts
  let pop = [], fit = []
  for (let i = 0; i < NP; i++) {
    const v = randomVectorMulti(linkageType, bounds)
    pop.push(v)
    fit.push(evaluateErrorMulti(linkageType, v, targetCurve))
  }

  // 将种子个体注入种群（替换适应度最差的个体）
  for (const seed of seeds) {
    const seedClamped = clampVectorMulti(linkageType, seed, bounds)
    const seedErr = evaluateErrorMulti(linkageType, seedClamped, targetCurve)
    if (!isFinite(seedErr)) continue
    // 找最差个体
    let worstIdx = 0
    for (let i = 1; i < NP; i++) {
      if (fit[i] > fit[worstIdx]) worstIdx = i
    }
    pop[worstIdx] = seedClamped
    fit[worstIdx] = seedErr
  }

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
        trial[k] = (Math.random() < 0.85 || j === jRand)
          ? pop[a][k] + Fg * (pop[b][k] - pop[c][k])
          : pop[i][k]
      }
      const clamped = clampVectorMulti(linkageType, trial, bounds)
      const err = evaluateErrorMulti(linkageType, clamped, targetCurve)
      if (err < fit[i]) { pop[i] = clamped; fit[i] = err }
    }
  }
  return pop.map((v, i) => ({ ...v, error: fit[i] })).sort((a, b) => a.error - b.error)
}

// ═══ 坐标下降 ═══

function coordinateDescentMulti(linkageType, candidate, targetCurve, bounds, maxIter = 400) {
  const pk = getParamKeys(linkageType)
  const KEYS = pk.all

  let best = { ...candidate }
  let bestErr = evaluateErrorMulti(linkageType, best, targetCurve)
  if (!isFinite(bestErr)) return { ...best, error: bestErr }

  function runCD(start, iterations) {
    let cur = { ...start }
    let curErr = evaluateErrorMulti(linkageType, cur, targetCurve)
    if (!isFinite(curErr)) return { point: cur, error: curErr }

    const deltas = {}
    for (const k of KEYS) {
      deltas[k] = (k === 'beta' || k === 'beta2' || k === 'phiBd' || k === 'phiDe')
        ? 0.15
        : (Math.abs(cur[k]) * 0.06 || 0.005)
    }

    for (let iter = 0; iter < iterations; iter++) {
      let improved = false
      const order = [...KEYS].sort(() => Math.random() - 0.5)
      for (const k of order) {
        for (const sign of [-1, 1]) {
          const trial = { ...cur }; trial[k] += sign * deltas[k]
          const clamped = clampVectorMulti(linkageType, trial, bounds)
          const err = evaluateErrorMulti(linkageType, clamped, targetCurve)
          if (err < curErr) { cur = clamped; curErr = err; improved = true; deltas[k] *= 1.4 }
        }
      }
      if (!improved) { for (const k of KEYS) deltas[k] *= 0.4 }
      if (Math.max(...KEYS.map(k => deltas[k])) < 1e-9) break
    }
    return { point: cur, error: curErr }
  }

  let result = runCD(best, maxIter)
  best = result.point; bestErr = result.error

  // 扰动跳出浅层局部最优
  for (let attempt = 0; attempt < 2; attempt++) {
    if (bestErr < 0.01) break
    const perturbed = {}
    for (const k of KEYS) {
      const delta = Math.abs(best[k]) * 0.15 || (bounds.maxR || 1) * 0.02
      perturbed[k] = best[k] + (Math.random() - 0.5) * 2 * delta
    }
    const clamped = clampVectorMulti(linkageType, perturbed, bounds)
    const pErr = evaluateErrorMulti(linkageType, clamped, targetCurve)
    if (!isFinite(pErr) || pErr > bestErr * 5) continue
    result = runCD(clamped, Math.floor(maxIter / 2))
    if (result.error < bestErr) { best = result.point; bestErr = result.error }
  }

  return { ...best, error: bestErr }
}

// ═══ Pivot 精修 ═══

function refinePivotsMulti(linkageType, targetCurve, candidate, bounds, maxIter = 200) {
  const pk = getParamKeys(linkageType)
  const KEYS = pk.all
  const PIVOT_KEYS = pk.pivots

  let best = { ...candidate }
  let bestErr = candidate.error ?? evaluateErrorMulti(linkageType, best, targetCurve)
  if (!isFinite(bestErr)) return best

  const deltas = {}
  for (const k of PIVOT_KEYS) {
    deltas[k] = Math.abs(best[k]) * 0.02 || bounds.maxR * 0.005
  }

  function pivotClamp(trial) {
    const c = {}
    for (const k of KEYS) {
      if (PIVOT_KEYS.includes(k)) {
        c[k] = Math.max(bounds[k]?.[0] ?? -Infinity, Math.min(bounds[k]?.[1] ?? Infinity, trial[k]))
      } else {
        c[k] = best[k]
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
        const err = evaluateErrorMulti(linkageType, clamped, targetCurve)
        if (err < bestErr) {
          best = clamped; bestErr = err; improved = true
          deltas[k] *= 1.4
        }
      }
    }
    if (!improved) {
      for (const k of PIVOT_KEYS) deltas[k] *= 0.35
    }
    if (Math.max(...PIVOT_KEYS.map(k => deltas[k])) < 1e-9) break
  }

  return { ...best, error: bestErr }
}

// ═══ 导出 API ═══

/**
 * 第一轮优化：DE 全局搜索 → CD 精修 → Pivot 精修
 * @param {string} linkageType - 连杆类型 (fourbar|watt1|stephenson1)
 * @param {Array} targetCurve - 目标曲线点集
 * @param {Function} onProgress - 进度回调
 * @param {object|null} initFrom - 从四杆结果初始化的六杆参数（用于递进优化）
 */
export async function optimizeLinkage(linkageType, targetCurve, onProgress, initFrom = null) {
  if (targetCurve.length < 10) return null

  const bounds = buildBoundsMulti(linkageType, targetCurve)
  const extraGens = bounds.selfIntersect ? 40 : 0

  if (onProgress) onProgress(0.02)

  // 对于六杆机构且提供了初始四杆结果，用升级后的种子替换部分初始种群
  const deResults = differentialEvolutionMulti(linkageType, targetCurve, bounds, {
    NP: 80,
    generations: 100 + extraGens,
    seeds: initFrom ? [initFrom] : []
  })

  const topN = deResults.slice(0, 12)
  if (onProgress) onProgress(0.70)
  if (topN.length === 0) return null

  const refined = []
  for (let i = 0; i < topN.length; i++) {
    const cd = coordinateDescentMulti(linkageType, topN[i], targetCurve, bounds, bounds.selfIntersect ? 500 : 400)
    refined.push(refinePivotsMulti(linkageType, targetCurve, cd, bounds))
    if (onProgress) onProgress(0.70 + ((i + 1) / topN.length) * 0.30)
    await new Promise(r => setTimeout(r, 0))
  }
  refined.sort((a, b) => a.error - b.error)
  return { ...refined[0], linkageType }
}

/**
 * 后续轮次：在当前位置缩小边界重新搜索
 */
export async function optimizeContinue(linkageType, targetCurve, current, onProgress) {
  const pk = getParamKeys(linkageType)
  const KEYS = pk.all
  const fullBounds = buildBoundsMulti(linkageType, targetCurve)
  const shrink = 0.3
  const bounds = {}

  for (const k of KEYS) {
    if (k === 'beta' || k === 'beta2' || k === 'phiBd' || k === 'phiDe') {
      bounds[k] = [current[k] - 0.5, current[k] + 0.5]
    } else {
      const r = Math.abs(current[k]) * shrink || fullBounds.maxR * 0.1
      bounds[k] = [current[k] - r, current[k] + r]
    }
  }
  // 确保正长度参数
  const lengthKeys = KEYS.filter(k =>
    k.startsWith('a') || k.startsWith('b') || k.startsWith('c') ||
    k.startsWith('e') || k === 'lBd' || k === 'lDe'
  )
  for (const k of lengthKeys) bounds[k][0] = Math.max(0.0001, bounds[k][0])

  bounds.selfIntersect = fullBounds.selfIntersect
  bounds.maxR = fullBounds.maxR
  bounds.pca = fullBounds.pca

  if (onProgress) onProgress(0.05)

  const NP = 40, G = 60
  let pop = [], fit = []
  for (let i = 0; i < NP; i++) {
    pop.push(randomVectorMulti(linkageType, bounds))
    fit.push(evaluateErrorMulti(linkageType, pop[i], targetCurve))
  }
  pop[0] = { ...current }
  fit[0] = evaluateErrorMulti(linkageType, current, targetCurve)

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
        trial[k] = (Math.random() < 0.8 || j === jRand)
          ? pop[a][k] + Fg * (pop[b][k] - pop[c][k])
          : pop[i][k]
      }
      const clamped = clampVectorMulti(linkageType, trial, bounds)
      const err = evaluateErrorMulti(linkageType, clamped, targetCurve)
      if (err < fit[i]) { pop[i] = clamped; fit[i] = err }
    }
    if (onProgress && gen % 10 === 0) onProgress(0.05 + (gen / G) * 0.55)
  }

  if (onProgress) onProgress(0.60)
  const ranked = pop.map((v, i) => ({ ...v, error: fit[i] })).sort((a, b) => a.error - b.error)
  const topN = ranked.slice(0, 8)

  const refined = []
  for (let i = 0; i < topN.length; i++) {
    const cd = coordinateDescentMulti(linkageType, topN[i], targetCurve, bounds, 300)
    refined.push(refinePivotsMulti(linkageType, targetCurve, cd, bounds))
    if (onProgress) onProgress(0.60 + ((i + 1) / topN.length) * 0.40)
    await new Promise(r => setTimeout(r, 0))
  }
  refined.sort((a, b) => a.error - b.error)
  return { ...refined[0], linkageType }
}

/**
 * 将四杆优化结果升级为六杆初始参数。
 * 用于递进式优化策略：先跑四杆，再将结果扩展为六杆的初始猜测。
 */
export function upgradeFourBarToSixBar(fourBarResult, linkageType) {
  const fb = fourBarResult
  const base = {
    o2x: fb.o2x, o2y: fb.o2y,
    o4x: fb.o4x, o4y: fb.o4y,
    a1: fb.a, b1: fb.b, c1: fb.c
  }

  // O6 置于 O4 的对称位置（相对于质心方向延伸）
  const dx = fb.o4x - fb.o2x
  const dy = fb.o4y - fb.o2y
  const gd = Math.sqrt(dx * dx + dy * dy)

  if (linkageType === LINKAGE_TYPES.WATT_I) {
    return {
      ...base,
      o6x: fb.o4x + dx * 0.6, o6y: fb.o4y + dy * 0.6,
      a2: fb.a * 0.8, b2: fb.b * 0.7, c2: fb.c * 0.7,
      lBd: fb.e * 0.5, phiBd: fb.beta,
      e2: fb.e * 0.6, beta2: 0
    }
  } else {
    return {
      ...base,
      o6x: fb.o4x + dx * 0.6, o6y: fb.o4y + dy * 0.6,
      a2: fb.a * 0.8, b2: fb.b * 0.7, c2: fb.c * 0.7,
      lBd: fb.b * 0.3, phiBd: 0,
      lDe: fb.e * 0.5, phiDe: fb.beta
    }
  }
}
