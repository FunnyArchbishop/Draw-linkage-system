/**
 * 四连杆机构位置分析与耦合曲线计算。
 * 物理仿真——机构无法装配时返回 null。
 */

/** 可装配性：最长杆 < 其余三杆之和（三角形不等式） */
export function isAssemblable(a, b, c, groundDist) {
  const lengths = [groundDist, a, b, c]
  const longest = Math.max(...lengths)
  const sumOthers = lengths.reduce((s, l) => s + l, 0) - longest
  return longest < sumOthers
}

/** Grashof 曲柄-摇杆条件：曲柄 a 为最短杆，且能整周 360° 旋转。 */
export function isGrashofCrankRocker(a, b, c, groundDist) {
  const links = [a, b, c, groundDist]
  const shortest = Math.min(...links)
  if (shortest !== a) return false // 曲柄必须是最短杆
  const longest = Math.max(...links)
  const sum = links.reduce((s, l) => s + l, 0)
  return (shortest + longest) <= (sum - shortest - longest)
}

/**
 * 给定曲柄转角 θ₂，求解四杆机构位置。
 * 返回 A(曲柄-连杆铰接点)、B(连杆-摇杆铰接点) 及各杆角度。
 * 若该角度无解（cos φ 超出范围）则返回 null。
 */
export function solveFourBar(a, b, c, theta2, O2, O4) {
  const Ax = O2.x + a * Math.cos(theta2)
  const Ay = O2.y + a * Math.sin(theta2)
  const dx = O4.x - Ax
  const dy = O4.y - Ay
  const d = Math.sqrt(dx * dx + dy * dy)

  const cosPhi = (b * b + d * d - c * c) / (2 * b * d)
  if (Math.abs(cosPhi) > 1) return null

  const phi = Math.atan2(dy, dx)
  const gamma = Math.acos(cosPhi)
  const theta3 = phi - gamma
  const Bx = Ax + b * Math.cos(theta3)
  const By = Ay + b * Math.sin(theta3)
  const theta4 = Math.atan2(By - O4.y, Bx - O4.x)

  return { A: { x: Ax, y: Ay }, B: { x: Bx, y: By }, theta3, theta4 }
}

/** 计算耦合点 P 的位置 */
export function couplerPoint(A, theta3, e, beta) {
  return { x: A.x + e * Math.cos(theta3 + beta), y: A.y + e * Math.sin(theta3 + beta) }
}

/**
 * 计算完整耦合曲线（曲柄旋转 360°）。
 * 返回 points 数组（无效位置为 null）和 validRange（连续有效段）。
 */
export function computeCouplerCurve(params, numSteps = 360) {
  const { a, b, c, e, beta, O2, O4 } = params
  const points = [], validRange = []

  for (let i = 0; i < numSteps; i++) {
    const theta = (2 * Math.PI * i) / numSteps
    const sol = solveFourBar(a, b, c, theta, O2, O4)
    if (sol === null) { points.push(null) }
    else {
      const P = couplerPoint(sol.A, sol.theta3, e, beta)
      points.push({ x: P.x, y: P.y, ax: sol.A.x, ay: sol.A.y, bx: sol.B.x, by: sol.B.y, theta, theta3: sol.theta3, valid: true })
    }
  }

  let rs = -1
  for (let i = 0; i <= points.length; i++) {
    const v = i < points.length && points[i] !== null
    if (v && rs === -1) rs = i
    else if (!v && rs !== -1) { validRange.push({ start: rs, end: i - 1 }); rs = -1 }
  }
  return { points, validRange }
}

/** 获取机构在指定角度 θ 的完整状态（用于动画渲染） */
export function getLinkageState(params, theta) {
  const { a, b, c, e, beta, O2, O4 } = params
  const sol = solveFourBar(a, b, c, theta, O2, O4)
  if (!sol) return null
  const P = couplerPoint(sol.A, sol.theta3, e, beta)
  return { O2: { x: O2.x, y: O2.y }, O4: { x: O4.x, y: O4.y }, A: { x: sol.A.x, y: sol.A.y }, B: { x: sol.B.x, y: sol.B.y }, P: { x: P.x, y: P.y }, theta, theta3: sol.theta3, theta4: sol.theta4 }
}

/** 获取当前状态下各杆件长度（用于显示） */
export function getLinkLengths(state) {
  return {
    ground: Math.sqrt((state.O4.x - state.O2.x) ** 2 + (state.O4.y - state.O2.y) ** 2),
    crank: Math.sqrt((state.A.x - state.O2.x) ** 2 + (state.A.y - state.O2.y) ** 2),
    coupler: Math.sqrt((state.B.x - state.A.x) ** 2 + (state.B.y - state.A.y) ** 2),
    rocker: Math.sqrt((state.B.x - state.O4.x) ** 2 + (state.B.y - state.O4.y) ** 2)
  }
}
