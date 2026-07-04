<template>
  <div class="linkage-panel">
    <div class="panel-header">
      <h3>多连杆机构 Multi-Bar Linkage</h3>
      <span class="subtitle">差分进化全局优化 · 最大程度近似手绘轨迹</span>
    </div>

    <!-- 连杆类型选择器 -->
    <div class="type-selector">
      <label class="type-label">机构类型:</label>
      <select class="type-select" :value="linkage.state.linkageType"
        @change="onTypeChange($event)" :disabled="linkage.state.isOptimizing">
        <option value="fourbar">⚙ 四杆机构 (9参数)</option>
        <option value="watt1">🔗 六杆瓦特I型 (17参数)</option>
        <option value="stephenson1">🔗 六杆斯蒂芬森I型 (17参数)</option>
      </select>
    </div>

    <div v-if="!trajectory.hasTrajectory.value" class="empty-state">
      请先在画布上绘制一条闭合轨迹
    </div>

    <template v-else>
      <div class="step-section">
        <button class="btn btn-optimize" :disabled="!linkage.canOptimize.value" @click="linkage.optimize()">
          {{ linkage.state.isOptimizing && linkage.state.round === 1 ? '⏳ 优化中...' : '🔧 第1轮: 自动优化' }}
        </button>

        <div class="target-error-row" v-if="linkage.state.params || !linkage.state.isOptimizing">
          <label class="target-label">目标误差:</label>
          <input
            type="number"
            class="target-input"
            :value="linkage.state.targetError"
            @input="onTargetChange($event)"
            placeholder="如 0.05"
            step="0.001"
            min="0"
            :disabled="linkage.state.autoIterating"
          />
          <button
            v-if="linkage.state.autoIterating"
            class="btn btn-stop-auto"
            @click="linkage.cancelAutoIterate()"
          >⏹ 停止</button>
        </div>
        <span v-if="linkage.state.autoIterating" class="auto-badge">🔄 自动迭代中 (目标 ≤{{ linkage.state.targetError }})</span>
        <button v-if="linkage.state.params && !linkage.state.isOptimizing"
          class="btn btn-continue" @click="linkage.continueOptimize()">
          🔄 继续优化 (缩小搜索范围)
        </button>
        <div v-if="linkage.state.isOptimizing" class="progress-bar">
          <div class="progress-fill" :style="{ width: linkage.state.progress + '%' }"></div>
        </div>
        <div class="status-msg" :class="{ error: linkage.state.error !== null && linkage.state.error > 0.5 }">
          {{ linkage.state.statusMessage }}
        </div>
      </div>

      <div class="step-section" v-if="linkage.state.params">
        <SliderControl label="播放速度" :modelValue="linkage.state.speed"
          @update:modelValue="linkage.state.speed = $event"
          :min="0.1" :max="5" :step="0.1" :format="(v) => v.toFixed(1) + 'x'" />
        <div class="button-row">
          <button v-if="!linkage.state.isAnimating" class="btn btn-play" @click="linkage.startAnimation()">▶ 播放</button>
          <button v-else class="btn btn-stop" @click="linkage.stopAnimation()">⏹ 停止</button>
        </div>
      </div>

      <div v-if="linkage.state.params" class="params-section">
        <h4>优化结果</h4>

        <!-- Pivots -->
        <div class="param-group">
          <div class="group-title">枢轴位置</div>
          <table>
            <tbody>
            <tr v-if="linkage.state.O2"><td class="pname">O2</td><td class="pval">({{ linkage.state.O2.x.toFixed(3) }}, {{ linkage.state.O2.y.toFixed(3) }})</td></tr>
            <tr v-if="linkage.state.O4"><td class="pname">O4</td><td class="pval">({{ linkage.state.O4.x.toFixed(3) }}, {{ linkage.state.O4.y.toFixed(3) }})</td></tr>
            <tr v-if="linkage.state.O6"><td class="pname">O6</td><td class="pval">({{ linkage.state.O6.x.toFixed(3) }}, {{ linkage.state.O6.y.toFixed(3) }})</td></tr>
            </tbody>
          </table>
        </div>

        <!-- 子回路参数 -->
        <div v-for="(sub, idx) in linkage.state.subLinkages" :key="idx" class="param-group">
          <div class="group-title">{{ sub.name }}</div>
          <table>
            <tbody>
            <tr v-if="sub.a !== undefined"><td class="pname">{{ idx === 0 ? (linkage.state.linkageType === 'fourbar' ? 'a 曲柄' : 'a1 曲柄1') : 'a2 曲柄2' }}</td><td class="pval">{{ sub.a.toFixed(4) }}</td></tr>
            <tr v-if="sub.b !== undefined"><td class="pname">{{ idx === 0 ? (linkage.state.linkageType === 'fourbar' ? 'b 连杆' : 'b1 连杆1') : 'b2 连杆2' }}</td><td class="pval">{{ sub.b.toFixed(4) }}</td></tr>
            <tr v-if="sub.c !== undefined"><td class="pname">{{ idx === 0 ? (linkage.state.linkageType === 'fourbar' ? 'c 摇杆' : 'c1 摇杆1') : 'c2 摇杆2' }}</td><td class="pval">{{ sub.c.toFixed(4) }}</td></tr>
            <tr v-if="sub.e !== undefined"><td class="pname">e AP距</td><td class="pval">{{ sub.e.toFixed(4) }}</td></tr>
            <tr v-if="sub.beta !== undefined"><td class="pname">beta 耦合角</td><td class="pval">{{ (sub.beta * 180 / Math.PI).toFixed(1) }}°</td></tr>
            </tbody>
          </table>
        </div>

        <!-- 六杆耦合参数 -->
        <div v-if="linkage.state.linkageType !== 'fourbar' && linkage.state.params" class="param-group">
          <div class="group-title">耦合参数</div>
          <table>
            <tbody>
            <tr v-if="linkage.state.params.lBd !== undefined"><td class="pname">lBD 耦合连杆</td><td class="pval">{{ linkage.state.params.lBd.toFixed(4) }}</td></tr>
            <tr v-if="linkage.state.params.phiBd !== undefined"><td class="pname">phiBD 耦合角</td><td class="pval">{{ (linkage.state.params.phiBd * 180 / Math.PI).toFixed(1) }}°</td></tr>
            <tr v-if="linkage.state.params.e2 !== undefined"><td class="pname">e2 输出距</td><td class="pval">{{ linkage.state.params.e2.toFixed(4) }}</td></tr>
            <tr v-if="linkage.state.params.beta2 !== undefined"><td class="pname">beta2 输出角</td><td class="pval">{{ (linkage.state.params.beta2 * 180 / Math.PI).toFixed(1) }}°</td></tr>
            <tr v-if="linkage.state.params.lDe !== undefined"><td class="pname">lDE 输出距</td><td class="pval">{{ linkage.state.params.lDe.toFixed(4) }}</td></tr>
            <tr v-if="linkage.state.params.phiDe !== undefined"><td class="pname">phiDE 输出角</td><td class="pval">{{ (linkage.state.params.phiDe * 180 / Math.PI).toFixed(1) }}°</td></tr>
            </tbody>
          </table>
        </div>

        <table class="error-table">
          <tbody>
          <tr class="error-row"><td class="pname">拟合误差</td><td class="pval" :class="{ 'error-val': linkage.state.error > 0.3 }">{{ linkage.state.error.toFixed(4) }}</td></tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup>
import { useTrajectory } from '../../composables/useTrajectory.js'
import { useLinkage } from '../../composables/useLinkage.js'
import { LINKAGE_TYPES } from '../../engine/multibar.js'
import SliderControl from '../ui/SliderControl.vue'
const trajectory = useTrajectory(); const linkage = useLinkage()

function onTargetChange(e) {
  const v = e.target.value
  linkage.setTargetError(v === '' ? null : parseFloat(v))
}

function onTypeChange(e) {
  linkage.setLinkageType(e.target.value)
}
</script>

<style scoped>
.linkage-panel { padding:12px }
.panel-header { margin-bottom:8px }
.panel-header h3 { margin:0; color:#ccd6f6; font-size:18px; font-weight:500 }
.panel-header .subtitle { color:#5a6a8a; font-size:14px }
.empty-state { text-align:center; padding:30px 20px; color:#5a6a8a; font-size:14px }
.step-section { margin-bottom:12px }
.type-selector { display:flex; align-items:center; gap:8px; margin-bottom:12px; padding:8px; background:#112240; border-radius:6px }
.type-label { color:#8892b0; font-size:13px; white-space:nowrap }
.type-select { flex:1; padding:6px 8px; background:#0d1b2a; border:1px solid #1a3a5c; color:#ccd6f6; font-size:14px; font-family:inherit; border-radius:4px; cursor:pointer }
.type-select:focus { outline:none; border-color:#64ffda }
.type-select:disabled { opacity:.4; cursor:not-allowed }
.btn { padding:8px 16px; border:none; border-radius:6px; font-size:17px; font-weight:500; cursor:pointer; transition:all .2s; font-family:inherit; width:100% }
.btn:disabled { opacity:.4; cursor:not-allowed }
.btn-optimize { background:#1a3a5c; color:#64ffda } .btn-optimize:hover:not(:disabled) { background:#234a6e }
.btn-continue { background:#1a2540; color:#ffd54f; margin-top:6px } .btn-continue:hover:not(:disabled) { background:#2a3550 }
.btn-play { background:#1a3a2a; color:#4CAF50; width:auto; flex:1 } .btn-play:hover:not(:disabled) { background:#234a3a }
.btn-stop { background:#3a1a1a; color:#F44336; width:auto; flex:1 } .btn-stop:hover { background:#4a2a2a }
.button-row { display:flex; gap:8px }
.progress-bar { height:4px; background:#1a2540; border-radius:2px; margin-top:8px; overflow:hidden }
.progress-fill { height:100%; background:linear-gradient(90deg,#64ffda,#4CAF50); border-radius:2px; transition:width .3s }
.status-msg { font-size:15px; color:#5a6a8a; margin-top:6px; font-family:monospace }
.status-msg.error { color:#F44336 }
.params-section { margin-top:8px }
.params-section h4 { margin:0 0 6px; color:#8892b0; font-size:17px; font-weight:500 }
.param-group { margin-bottom:10px }
.param-group .group-title { color:#64ffda; font-size:13px; font-weight:500; margin-bottom:4px; padding:2px 6px; background:rgba(100,255,218,.08); border-radius:3px; display:inline-block }
table { width:100%; border-collapse:collapse; font-size:14px; font-family:monospace }
td { padding:3px 8px; border-bottom:1px solid #0d1b2a }
td.pname { color:#8892b0 } 
td.pval { color:#ccd6f6; text-align:right; font-weight:500 }
.error-table { margin-top:8px }
.error-row td { border-top:1px solid #1a3a5c } .error-val { color:#F44336!important }
.target-error-row { display:flex; align-items:center; gap:6px; margin-top:6px }
.target-label { color:#8892b0; font-size:13px; white-space:nowrap }
.target-input { width:80px; padding:4px 6px; background:#0d1b2a; border:1px solid #1a3a5c; color:#ccd6f6; font-size:13px; font-family:monospace; border-radius:4px }
.target-input:focus { outline:none; border-color:#64ffda }
.target-input:disabled { opacity:.4 }
.btn-stop-auto { padding:4px 10px; border:none; border-radius:4px; background:#3a1a1a; color:#F44336; font-size:12px; font-family:inherit; cursor:pointer; white-space:nowrap }
.btn-stop-auto:hover { background:#4a2a2a }
.auto-badge { display:block; color:#ffd54f; font-size:12px; font-family:monospace; margin-top:4px }
</style>
