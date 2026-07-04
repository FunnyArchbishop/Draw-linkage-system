/**
 * 多连杆机构运动学引擎。
 * 支持：四杆(FourBar)、六杆瓦特I型(Watt-I)、六杆斯蒂芬森I型(Stephenson-I)。
 *
 * 六杆机构分解为两个四杆子回路，通过耦合三角形连接。
 * 正向运动学：曲柄角 → 子回路1 → 耦合点 → 子回路2 → 输出点。
 */

import { solveFourBar, couplerPoint } from './fourbar.js'

// ═══ 连杆类型定义 ═══

export const LINKAGE_TYPES = {
  FOUR_BAR: 'fourbar',
  WATT_I: 'watt1',
  STEPHENSON_I: 'stephenson1'
}

export const LINKAGE_LABELS = {
  fourbar: '四杆机构',
  watt1: '六杆瓦特I型',
  stephenson1: '六杆斯蒂芬森I型'
}

/** 获取各类型参数键列表 */
export function getParamKeys(type) {
  switch (type) {
    case 'fourbar':
      return {
        all: ['o2x', 'o2y', 'o4x', 'o4y', 'a', 'b', 'c', 'e', 'beta'],
        pivots: ['o2x', 'o2y', 'o4x', 'o4y'],
        links: ['a', 'b', 'c'],
        coupler: ['e', 'beta']
      }
    case 'watt1':
      return {
        all: [
          'o2x', 'o2y', 'o4x', 'o4y', 'o6x', 'o6y',
          'a1', 'b1', 'c1', 'a2', 'b2', 'c2',
          'lBd', 'phiBd', 'e2', 'beta2'
        ],
        pivots: ['o2x', 'o2y', 'o4x', 'o4y', 'o6x', 'o6y'],
        links1: ['a1', 'b1', 'c1'],
        links2: ['a2', 'b2', 'c2'],
        coupler2: ['lBd', 'phiBd', 'e2', 'beta2']
      }
    case 'stephenson1':
      return {
        all: [
          'o2x', 'o2y', 'o4x', 'o4y', 'o6x', 'o6y',
          'a1', 'b1', 'c1', 'a2', 'b2', 'c2',
          'lBd', 'phiBd', 'lDe', 'phiDe'
        ],
        pivots: ['o2x', 'o2y', 'o4x', 'o4y', 'o6x', 'o6y'],
        links1: ['a1', 'b1', 'c1'],
        links2: ['a2', 'b2', 'c2'],
        coupler2: ['lBd', 'phiBd', 'lDe', 'phiDe']
      }
    default:
      return { all: [], pivots: [], links: [], coupler: [] }
  }
}

/** 获取参数显示名映射 */
export function getParamLabels(type) {
  const base = {
    o2x: 'O2 X', o2y: 'O2 Y',
    o4x: 'O4 X', o4y: 'O4 Y',
    o6x: 'O6 X', o6y: 'O6 Y',
    a: 'a 曲柄', b: 'b 连杆', c: 'c 摇杆',
    a1: 'a1 曲柄1', b1: 'b1 连杆1', c1: 'c1 摇杆1',
    a2: 'a2 曲柄2', b2: 'b2 连杆2', c2: 'c2 摇杆2',
    e: 'e AP距', beta: 'beta 耦合角',
    e2: 'e2 输出距', beta2: 'beta2 耦合角',
    lBd: 'lBD 耦合连杆', phiBd: 'phiBD 耦合角',
    lDe: 'lDE 输出距', phiDe: 'phiDE 输出角'
  }
  const keys = getParamKeys(type).all
  const result = {}
  for (const k of keys) result[k] = base[k] || k
  return result
}

// ═══ 六杆瓦特I型 (Watt-I) 正向运动学 ═══

/**
 * 求解六杆瓦特I型机构。
 *
 * 拓扑:
 *   子回路1: O?-A-B-O? (四杆，曲柄 a1，连杆 b1，摇杆 c1)
 *   耦合三角形: B 点与 D 点通过刚性连杆 lBd 连接，∠ABD = phiBd
 *   子回路2: O?-D-E-O? (四杆，曲柄 a2，连杆 b2，摇杆 c2)
 *   输出点 P: 在连杆 DE 上，距 D 为 e2，角度为 beta2
 *
 * @param {object} params - { o2x,o2y, o4x,o4y, o6x,o6y, a1,b1,c1, a2,b2,c2, lBd,phiBd, e2,beta2 }
 * @param {number} theta2 - 主曲柄转角 (rad)
 * @returns {object|null} 完整机构状态或 null
 */
export function solveWattI(params, theta2) {
  const {
    o2x, o2y, o4x, o4y, o6x, o6y,
    a1, b1, c1, a2, b2, c2,
    lBd, phiBd, e2, beta2
  } = params

  const O2 = { x: o2x, y: o2y }
  const O4 = { x: o4x, y: o4y }
  const O6 = { x: o6x, y: o6y }

  // --- 步骤1: 求解子回路1 ---
  const sol1 = solveFourBar(a1, b1, c1, theta2, O2, O4)
  if (!sol1) return null

  const A = sol1.A
  const B = sol1.B
  const theta3_1 = sol1.theta3  // 连杆AB角度

  // --- 步骤2: 从耦合三角形求解D点 ---
  // 已知: B, O4, |BD| = lBd, |O4D| = a2, |O4B| = c1
  // 三角形 O4-B-D: 三边已知 → SSS求解
  const o4bDx = B.x - O4.x
  const o4bDy = B.y - O4.y
  const o4bDist = Math.sqrt(o4bDx * o4bDx + o4bDy * o4bDy)  // = c1 (应相等)

  // 实际O4B距离可能与c1略有出入（累积误差），重新计算
  const d_o4b = o4bDist
  const d_bd = lBd
  const d_o4d = a2

  // 三角形不等式检查
  if (d_o4b + d_bd < d_o4d || d_o4b + d_o4d < d_bd || d_bd + d_o4d < d_o4b) {
    return null
  }

  // O4→B 方向角
  const phi_o4b = Math.atan2(o4bDy, o4bDx)

  // 余弦定理：cos(∠BO4D) = (d_o4b? + d_o4d? - d_bd?) / (2·d_o4b·d_o4d)
  const cosAngleD = (d_o4b * d_o4b + d_o4d * d_o4d - d_bd * d_bd) / (2 * d_o4b * d_o4d)
  if (Math.abs(cosAngleD) > 1) return null
  const angleD = Math.acos(cosAngleD)

  // D 有两个可能位置（装配模式），选择与 phiBd 一致的
  // phiBd 是 ∠ABD，表示从 BA 方向到 BD 方向的夹角
  const baAngle = Math.atan2(B.y - A.y, B.x - A.x)  // A→B 方向
  // BD 期望方向 = BA方向反转 + phiBd = (baAngle + π) + phiBd
  const expectedBDAngle = baAngle + Math.PI + phiBd

  // 两个候选D
  const candidates = [
    { angle: phi_o4b + angleD },
    { angle: phi_o4b - angleD }
  ]

  let D = null
  let bestAngleDiff = Infinity
  for (const cand of candidates) {
    const Dx = O4.x + d_o4d * Math.cos(cand.angle)
    const Dy = O4.y + d_o4d * Math.sin(cand.angle)
    const bdAngle = Math.atan2(Dy - B.y, Dx - B.x)
    // 角度差（归一化）
    let diff = bdAngle - expectedBDAngle
    while (diff > Math.PI) diff -= 2 * Math.PI
    while (diff < -Math.PI) diff += 2 * Math.PI
    if (Math.abs(diff) < Math.abs(bestAngleDiff)) {
      bestAngleDiff = diff
      D = { x: Dx, y: Dy }
    }
  }

  if (!D) return null

  // --- 步骤3: 求解子回路2 ---
  const theta2_2 = Math.atan2(D.y - O4.y, D.x - O4.x)
  const sol2 = solveFourBar(a2, b2, c2, theta2_2, O4, O6)
  if (!sol2) return null

  const E = sol2.B  // 子回路2中连杆-摇杆铰接点
  const theta3_2 = sol2.theta3

  // --- 步骤4: 计算输出点 P ---
  // P 在连杆DE上，从D延伸 e2，角度偏移 beta2
  const deAngle = Math.atan2(E.y - D.y, E.x - D.x)
  const P = {
    x: D.x + e2 * Math.cos(deAngle + beta2),
    y: D.y + e2 * Math.sin(deAngle + beta2)
  }

  return {
    O2, O4, O6,
    A, B,
    D, E, P,
    theta2,
    theta3_1: sol1.theta3, theta4_1: sol1.theta4,
    theta3_2: sol2.theta3, theta4_2: sol2.theta4
  }
}

// ═══ 六杆斯蒂芬森I型 (Stephenson-I) 正向运动学 ═══

/**
 * 求解六杆斯蒂芬森I型机构。
 *
 * 拓扑:
 *   子回路1: O?-A-B-O? (四杆，曲柄 a1，连杆 b1，摇杆 c1)
 *   三元连杆: A-B-D 为刚体三角形
 *   子回路2: O?-F-E-D (五杆约束…化简为 O?-D-E-O? 四杆近似)
 *   实际: D 由三元连杆驱动 → D 驱动子回路2的曲柄
 *   输出点 P: 在连杆 DE 上
 *
 * 简化处理: Stephenson-I 退化为 Watt-I 的变体，其中耦合三角形 ABD
 * 的 BD 边作为连接。
 */
export function solveStephensonI(params, theta2) {
  const {
    o2x, o2y, o4x, o4y, o6x, o6y,
    a1, b1, c1, a2, b2, c2,
    lBd, phiBd, lDe, phiDe
  } = params

  const O2 = { x: o2x, y: o2y }
  const O4 = { x: o4x, y: o4y }
  const O6 = { x: o6x, y: o6y }

  // --- 步骤1: 求解子回路1 ---
  const sol1 = solveFourBar(a1, b1, c1, theta2, O2, O4)
  if (!sol1) return null

  const A = sol1.A
  const B = sol1.B

  // --- 步骤2: 从三元连杆ABD求解D ---
  const baAngle = Math.atan2(B.y - A.y, B.x - A.x)
  // D 在 AB 连杆上，距离 A 为 lDe（沿 AB 方向偏移 phiDe）
  const aToDAngle = baAngle + phiDe
  const D = {
    x: A.x + lDe * Math.cos(aToDAngle),
    y: A.y + lDe * Math.sin(aToDAngle)
  }

  // --- 步骤3: 求解子回路 O4-D-E-O6 ---
  // 这里需要将 O4-D 视为曲柄，但 D 不一定绕 O4 旋转
  // Stephenson-I 中 D 是三元连杆上的一点，驱动摇杆 O6-E
  // 实际求解: 从 O4 和 O6 出发，满足 |O4-D| 约束

  // 简化: 将 O4-D-E-O6 视作四杆，其中 O4-D 为曲柄 (长度 = a2)，
  // 但 D 已由三元连杆确定，需要校核 |O4D| ≈ a2

  const o4dDist = Math.sqrt((D.x - O4.x) ** 2 + (D.y - O4.y) ** 2)

  // 检查装配: O4D 必须 ≤ a2 + tolerance
  if (o4dDist > a2 * 1.2 || o4dDist < a2 * 0.5) return null

  // 使用 O4D 方向作为子回路2的输入角
  const theta2_2 = Math.atan2(D.y - O4.y, D.x - O4.x)

  // 用实际 O4D 距离替代 a2 进行求解（因为 D 不精确在 a2 圆上）
  const a2Eff = o4dDist
  const sol2 = solveFourBar(a2Eff, b2, c2, theta2_2, O4, O6)
  if (!sol2) return null

  const E = sol2.B
  const theta3_2 = sol2.theta3

  // --- 步骤4: 输出点 P ---
  // P 在连杆 DE 上，从 D 延伸 e2=0，角度 beta2=0
  // 对于 Stephenson, 输出通常在 E 点或 DE 中点
  const deAngle = Math.atan2(E.y - D.y, E.x - D.x)
  const P = {
    x: D.x + (E.x - D.x) * 0.5,  // 默认为 DE 中点
    y: D.y + (E.y - D.y) * 0.5
  }

  return {
    O2, O4, O6,
    A, B,
    D, E, P,
    theta2,
    theta3_1: sol1.theta3, theta4_1: sol1.theta4,
    theta3_2: sol2.theta3, theta4_2: sol2.theta4
  }
}

// ═══ 通用求解接口 ═══

/**
 * 根据连杆类型求解机构状态。
 * @param {string} type - 连杆类型 (fourbar|watt1|stephenson1)
 * @param {object} params - 参数对象
 * @param {number} theta2 - 主曲柄转角
 * @returns {object|null}
 */
export function solveLinkage(type, params, theta2) {
  switch (type) {
    case 'fourbar': {
      const { o2x, o2y, o4x, o4y, a, b, c } = params
      const sol = solveFourBar(a, b, c, theta2,
        { x: o2x, y: o2y }, { x: o4x, y: o4y })
      if (!sol) return null
      const P = couplerPoint(sol.A, sol.theta3, params.e, params.beta)
      return {
        O2: { x: o2x, y: o2y },
        O4: { x: o4x, y: o4y },
        A: sol.A, B: sol.B, P,
        theta2,
        theta3_1: sol.theta3, theta4_1: sol.theta4
      }
    }
    case 'watt1':
      return solveWattI(params, theta2)
    case 'stephenson1':
      return solveStephensonI(params, theta2)
    default:
      return null
  }
}

/**
 * 计算耦合曲线（完整 360° 旋转）。
 * @returns {{ points: Array, validRange: Array }}
 */
export function computeCouplerCurveMulti(type, params, numSteps = 360) {
  const points = []
  const validRange = []

  for (let i = 0; i < numSteps; i++) {
    const theta = (2 * Math.PI * i) / numSteps
    const sol = solveLinkage(type, params, theta)
    if (sol === null) {
      points.push(null)
    } else {
      points.push({
        x: sol.P.x, y: sol.P.y,
        ax: sol.A?.x, ay: sol.A?.y,
        bx: sol.B?.x, by: sol.B?.y,
        dx: sol.D?.x, dy: sol.D?.y,
        ex: sol.E?.x, ey: sol.E?.y,
        theta,
        theta3_1: sol.theta3_1,
        valid: true
      })
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

/** 可装配性检查 */
export function isMultiBarAssemblable(type, params) {
  switch (type) {
    case 'fourbar': {
      const { o2x, o2y, o4x, o4y, a, b, c } = params
      const gd = Math.sqrt((o4x - o2x) ** 2 + (o4y - o2y) ** 2)
      const lengths = [gd, a, b, c]
      const longest = Math.max(...lengths)
      const sumOthers = lengths.reduce((s, l) => s + l, 0) - longest
      return longest < sumOthers
    }
    case 'watt1':
    case 'stephenson1': {
      const { o2x, o2y, o4x, o4y, o6x, o6y, a1, b1, c1, a2, b2, c2 } = params
      const g1 = Math.sqrt((o4x - o2x) ** 2 + (o4y - o2y) ** 2)
      const g2 = Math.sqrt((o6x - o4x) ** 2 + (o6y - o4y) ** 2)
      const check1 = (() => {
        const l = [g1, a1, b1, c1]
        const lo = Math.max(...l)
        return lo < l.reduce((s, v) => s + v, 0) - lo
      })()
      const check2 = (() => {
        const l = [g2, a2, b2, c2]
        const lo = Math.max(...l)
        return lo < l.reduce((s, v) => s + v, 0) - lo
      })()
      return check1 && check2
    }
    default: return false
  }
}

/** Grashof 曲柄-摇杆条件（主回路） */
export function isMultiBarGrashof(type, params) {
  switch (type) {
    case 'fourbar': {
      const { o2x, o2y, o4x, o4y, a, b, c } = params
      const gd = Math.sqrt((o4x - o2x) ** 2 + (o4y - o2y) ** 2)
      const links = [a, b, c, gd]
      const shortest = Math.min(...links)
      if (shortest !== a) return false
      const longest = Math.max(...links)
      const sum = links.reduce((s, l) => s + l, 0)
      return (shortest + longest) <= (sum - shortest - longest)
    }
    case 'watt1':
    case 'stephenson1': {
      const { o2x, o2y, o4x, o4y, a1, b1, c1 } = params
      const gd = Math.sqrt((o4x - o2x) ** 2 + (o4y - o2y) ** 2)
      const links = [a1, b1, c1, gd]
      const shortest = Math.min(...links)
      if (shortest !== a1) return false
      const longest = Math.max(...links)
      const sum = links.reduce((s, l) => s + l, 0)
      return (shortest + longest) <= (sum - shortest - longest)
    }
    default: return false
  }
}
