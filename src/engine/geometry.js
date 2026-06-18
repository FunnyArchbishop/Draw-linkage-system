/**
 * 几何工具：直角/极坐标转换、重采样、归一化、PCA。
 * 纯函数——无 Vue 依赖。
 */

/**
 * 直角坐标 → 极坐标
 * @param {number} x
 * @param {number} y
 * @param {number} originX
 * @param {number} originY
 * @returns {{ r: number, theta: number }}
 */
export function cartesianToPolar(x, y, originX = 0, originY = 0) {
  const dx = x - originX
  const dy = y - originY
  return {
    r: Math.sqrt(dx * dx + dy * dy),
    theta: Math.atan2(dy, dx)
  }
}

/**
 * 极坐标 → 直角坐标
 * @param {number} r
 * @param {number} theta
 * @param {number} originX
 * @param {number} originY
 * @returns {{ x: number, y: number }}
 */
export function polarToCartesian(r, theta, originX = 0, originY = 0) {
  return {
    x: originX + r * Math.cos(theta),
    y: originY + r * Math.sin(theta)
  }
}

/**
 * 点集质心（算术平均）
 * @param {Array<{x: number, y: number}>} points
 * @returns {{ x: number, y: number }}
 */
export function centroid(points) {
  if (points.length === 0) return { x: 0, y: 0 }
  const n = points.length
  let sx = 0, sy = 0
  for (const p of points) {
    sx += p.x
    sy += p.y
  }
  return { x: sx / n, y: sy / n }
}

/**
 * 沿折线计算累积弦长。
 * @param {Array<{x: number, y: number}>} points
 * @returns {number[]} 累积距离数组，首项为 0
 */
export function cumulativeDistances(points) {
  const dists = [0]
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    dists.push(dists[i - 1] + Math.sqrt(dx * dx + dy * dy))
  }
  return dists
}

/**
 * 弧长参数化重采样——将曲线均匀重采样为指定点数。
 * @param {Array<{x: number, y: number}>} points - 输入折线
 * @param {number} numSamples - 目标输出点数
 * @returns {Array<{x: number, y: number}>}
 */
export function resampleCurve(points, numSamples) {
  if (points.length < 2) return points.slice()
  if (numSamples < 2) return [points[0], points[points.length - 1]]

  const cumDist = cumulativeDistances(points)
  const totalLen = cumDist[cumDist.length - 1]
  if (totalLen === 0) return Array(numSamples).fill({ ...points[0] })

  const result = []
  for (let i = 0; i < numSamples; i++) {
    const targetDist = (i / (numSamples - 1)) * totalLen
    // 寻找包含目标距离的线段
    let seg = 1
    while (seg < cumDist.length && cumDist[seg] < targetDist) {
      seg++
    }
    if (seg >= cumDist.length) {
      result.push({ ...points[points.length - 1] })
      continue
    }
    const segStart = cumDist[seg - 1]
    const segLen = cumDist[seg] - segStart
    const t = segLen > 0 ? (targetDist - segStart) / segLen : 0
    const p0 = points[seg - 1]
    const p1 = points[seg]
    result.push({
      x: p0.x + t * (p1.x - p0.x),
      y: p0.y + t * (p1.y - p0.y)
    })
  }
  return result
}

/**
 * 曲线归一化：平移至质心原点，缩放至单位最大半径。
 * @param {Array<{x: number, y: number}>} points
 * @returns {Array<{x: number, y: number}>}
 */
export function normalizeCurve(points) {
  if (points.length === 0) return []
  const c = centroid(points)
  let maxR = 0
  const centered = points.map(p => {
    const dx = p.x - c.x
    const dy = p.y - c.y
    const r = Math.sqrt(dx * dx + dy * dy)
    if (r > maxR) maxR = r
    return { x: dx, y: dy }
  })
  if (maxR === 0) return centered
  return centered.map(p => ({ x: p.x / maxR, y: p.y / maxR }))
}

/**
 * 平移 + 均匀缩放点集。
 * @param {Array<{x: number, y: number}>} points
 * @param {number} tx
 * @param {number} ty
 * @param {number} scale
 * @returns {Array<{x: number, y: number}>}
 */
export function transformPoints(points, tx, ty, scale) {
  return points.map(p => ({
    x: p.x * scale + tx,
    y: p.y * scale + ty
  }))
}

/**
 * 两点间欧氏距离平方。
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @returns {number}
 */
export function distSq(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/**
 * 两点间欧氏距离。
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @returns {number}
 */
export function dist(a, b) {
  return Math.sqrt(distSq(a, b))
}

/**
 * 求点 P 到线段 AB 的最近点（正交投影，参数 t 截断至 [0,1]）。
 * @param {number} px
 * @param {number} py
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @returns {{ x: number, y: number, t: number, dist: number }}
 */
export function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) {
    const d = Math.sqrt((px - ax) ** 2 + (py - ay) ** 2)
    return { x: ax, y: ay, t: 0, dist: d }
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const x = ax + t * dx
  const y = ay + t * dy
  const d = Math.sqrt((px - x) ** 2 + (py - y) ** 2)
  return { x, y, t, dist: d }
}

/**
 * 两个点集之间的对称 Chamfer 距离。
 * @param {Array<{x: number, y: number}>} curveA
 * @param {Array<{x: number, y: number}>} curveB
 * @returns {number}
 */
export function chamferDistance(curveA, curveB) {
  if (curveA.length === 0 || curveB.length === 0) return Infinity

  let sumAtoB = 0
  for (const a of curveA) {
    let minD = Infinity
    for (const b of curveB) {
      const d = distSq(a, b)
      if (d < minD) minD = d
    }
    sumAtoB += Math.sqrt(minD)
  }

  let sumBtoA = 0
  for (const b of curveB) {
    let minD = Infinity
    for (const a of curveA) {
      const d = distSq(a, b)
      if (d < minD) minD = d
    }
    sumBtoA += Math.sqrt(minD)
  }

  return sumAtoB / curveA.length + sumBtoA / curveB.length
}

/**
 * 点集的轴对齐包围盒。
 * @param {Array<{x: number, y: number}>} points
 * @returns {{ minX: number, minY: number, maxX: number, maxY: number, width: number, height: number }}
 */
export function boundingBox(points) {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

/**
 * 等比缩放点集以适应 [margin, size-margin] 范围。
 * @param {Array<{x: number, y: number}>} points
 * @param {number} targetSize
 * @param {number} margin
 * @returns {{ points: Array<{x: number, y: number}>, scale: number, tx: number, ty: number }}
 */
export function fitToBounds(points, targetSize, margin = 40) {
  if (points.length === 0) return { points: [], scale: 1, tx: 0, ty: 0 }
  const bb = boundingBox(points)
  const usable = targetSize - 2 * margin
  const scale = Math.min(usable / bb.width, usable / bb.height, 1)
  if (!isFinite(scale)) return { points: points.slice(), scale: 1, tx: 0, ty: 0 }
  const tx = margin + (usable - bb.width * scale) / 2 - bb.minX * scale
  const ty = margin + (usable - bb.height * scale) / 2 - bb.minY * scale
  return {
    points: transformPoints(points, tx, ty, scale),
    scale,
    tx,
    ty
  }
}

/**
 * 对 2D 点集做主成分分析（PCA）。
 * 通过协方差矩阵特征分解（闭式解）计算主/次轴方向及跨度。
 * 用于沿曲线自然轴向收紧搜索边界。
 *
 * @param {Array<{x: number, y: number}>} points
 * @returns {{ center: {x: number, y: number}, majorAxis: {dx: number, dy: number}, minorAxis: {dx: number, dy: number}, majorSpan: number, minorSpan: number, aspectRatio: number }}
 */
export function computePCA(points) {
  if (points.length < 2) {
    return { center: { x: 0, y: 0 }, majorAxis: { dx: 1, dy: 0 }, minorAxis: { dx: 0, dy: 1 }, majorSpan: 0, minorSpan: 0, aspectRatio: 1 }
  }

  const c = centroid(points)
  const n = points.length

  // 协方差矩阵
  let covXX = 0, covYY = 0, covXY = 0
  for (const p of points) {
    const dx = p.x - c.x
    const dy = p.y - c.y
    covXX += dx * dx
    covYY += dy * dy
    covXY += dx * dy
  }
  covXX /= n; covYY /= n; covXY /= n

  // 2×2 对称矩阵特征值（闭式解）
  // λ = (迹 ± √(迹² − 4·行列式)) / 2
  const trace = covXX + covYY
  const det = covXX * covYY - covXY * covXY
  const disc = Math.sqrt(Math.max(0, trace * trace - 4 * det))
  const λ1 = (trace + disc) / 2  // 主特征值
  const λ2 = (trace - disc) / 2  // 次特征值

  // λ1 的特征向量（主轴方向）: (covXX − λ1)·x + covXY·y = 0
  let dx = covXY
  let dy = λ1 - covXX
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len > 1e-10) { dx /= len; dy /= len }
  else { dx = 1; dy = 0 }  // 退化：任选一方向

  const majorSpan = 2 * Math.sqrt(Math.max(0, λ1))
  const minorSpan = 2 * Math.sqrt(Math.max(0, λ2))

  return {
    center: c,
    majorAxis: { dx, dy },
    minorAxis: { dx: -dy, dy: dx },  // 垂直方向
    majorSpan,
    minorSpan,
    aspectRatio: minorSpan > 1e-10 ? majorSpan / minorSpan : 1
  }
}
