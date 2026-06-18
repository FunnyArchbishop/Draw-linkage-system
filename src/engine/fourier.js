/**
 * 二维封闭曲线的离散傅里叶变换。
 * 将每个点视为复信号 z = x + i*y。
 * 纯函数——无 Vue 依赖。
 */

/**
 * 计算复信号（封闭曲线）的 DFT。
 * 供优化器估算特征尺度 (f1Amp) 以设定搜索边界。
 *
 * Z[k] = (1/N) · Σ z[n] · exp(−i·2π·k·n/N)
 *
 * @param {Array<{x: number, y: number}>} points - 均匀采样点（先用 resampleCurve）
 * @param {number} numCoefficients - 保留谐波数（1 到 N）
 * @returns {Array<{freq: number, re: number, im: number, amp: number, phase: number}>}
 */
export function computeDFT(points, numCoefficients) {
  const N = points.length
  if (N === 0) return []

  const clampedCount = Math.min(numCoefficients, N)
  const coeffs = []

  for (let k = 0; k < clampedCount; k++) {
    let sumRe = 0, sumIm = 0
    for (let n = 0; n < N; n++) {
      const angle = (-2 * Math.PI * k * n) / N
      const cosA = Math.cos(angle)
      const sinA = Math.sin(angle)
      const p = points[n]
      // 复数乘法: z[n] * e^(-i*angle)
      sumRe += p.x * cosA - p.y * sinA
      sumIm += p.x * sinA + p.y * cosA
    }
    const re = sumRe / N
    const im = sumIm / N
    const amp = Math.sqrt(re * re + im * im)
    const phase = Math.atan2(im, re)
    coeffs.push({ freq: k, re, im, amp, phase })
  }

  return coeffs
}
