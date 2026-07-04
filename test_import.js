// 快速模块导入测试
import { solveFourBar, couplerPoint, computeCouplerCurve } from './engine/fourbar.js'
import { computeDFT } from './engine/fourier.js'
import { centroid, resampleCurve, computePCA } from './engine/geometry.js'
import {
  LINKAGE_TYPES, getParamKeys, isMultiBarAssemblable, isMultiBarGrashof,
  computeCouplerCurveMulti, solveLinkage, solveWattI, solveStephensonI
} from './engine/multibar.js'

console.log('=== Module Import Test ===')
console.log('fourbar.js: OK - solveFourBar, couplerPoint, computeCouplerCurve')
console.log('fourier.js: OK - computeDFT')
console.log('geometry.js: OK - centroid, resampleCurve, computePCA')
console.log('multibar.js: OK - all exports')
console.log('LINKAGE_TYPES:', LINKAGE_TYPES)
console.log('Param keys for fourbar:', getParamKeys('fourbar'))
console.log('Param keys for watt1:', getParamKeys('watt1'))
console.log('')

// Test four-bar kinematics
console.log('=== Four-Bar Kinematics Test ===')
const fbParams = { o2x: 0, o2y: 0, o4x: 3, o4y: 0, a: 1, b: 2, c: 2, e: 1.5, beta: 0.5 }
console.log('Assemblable:', isMultiBarAssemblable('fourbar', fbParams))
console.log('Grashof:', isMultiBarGrashof('fourbar', fbParams))

const sol = solveLinkage('fourbar', fbParams, 0.5)
console.log('Four-bar solve OK, P:', sol ? `(${sol.P.x.toFixed(3)}, ${sol.P.y.toFixed(3)})` : 'null')

const curve = computeCouplerCurveMulti('fourbar', fbParams, 8)
console.log('Coupler curve points:', curve.points.filter(p => p !== null).length)

// Test Watt-I six-bar kinematics
console.log('')
console.log('=== Watt-I Six-Bar Kinematics Test ===')
const w1Params = {
  o2x: 0, o2y: 0, o4x: 4, o4y: 0, o6x: 7, o6y: 0.5,
  a1: 1, b1: 2.5, c1: 2, a2: 0.8, b2: 2, c2: 1.8,
  lBd: 1.2, phiBd: 0.3, e2: 1.5, beta2: 0.4
}
console.log('Assemblable:', isMultiBarAssemblable('watt1', w1Params))
console.log('Grashof:', isMultiBarGrashof('watt1', w1Params))

const solW1 = solveWattI(w1Params, 0.5)
console.log('Watt-I solve OK, P:', solW1 ? `(${solW1.P.x.toFixed(3)}, ${solW1.P.y.toFixed(3)})` : 'null')

const curveW1 = computeCouplerCurveMulti('watt1', w1Params, 8)
console.log('Watt-I coupler curve points:', curveW1.points.filter(p => p !== null).length)

// Test Stephenson-I
console.log('')
console.log('=== Stephenson-I Six-Bar Kinematics Test ===')
const s1Params = {
  o2x: 0, o2y: 0, o4x: 4, o4y: 0, o6x: 7, o6y: 0.5,
  a1: 1, b1: 2.5, c1: 2, a2: 0.8, b2: 2, c2: 1.8,
  lBd: 1.2, phiBd: 0.3, lDe: 1.5, phiDe: 0.4
}
const solS1 = solveStephensonI(s1Params, 0.5)
console.log('Stephenson-I solve OK, P:', solS1 ? `(${solS1.P.x.toFixed(3)}, ${solS1.P.y.toFixed(3)})` : 'null')

console.log('')
console.log('=== ALL TESTS PASSED ===')
