# Track Generation — 四连杆机构轨迹综合

> 手绘一条封闭曲线，自动合成能复现该轨迹的四连杆机构（Four-Bar Linkage）。

![](https://img.shields.io/badge/Vue-3.4-4FC08D?logo=vue.js)
![](https://img.shields.io/badge/Vite-5.x-646CFF?logo=vite)
![](https://img.shields.io/badge/algorithm-Differential%20Evolution-orange)
![](https://img.shields.io/badge/kinematics-Four--Bar%20Linkage-blue)

---

## 目录

- [问题定义](#问题定义)
- [项目结构](#项目结构)
- [计算管线](#计算管线)
- [模块详解](#模块详解)
  - [1. 四连杆运动学 (`fourbar.js`)](#1-四连杆运动学-fourbarjs)
  - [2. 几何工具 (`geometry.js`)](#2-几何工具-geometryjs)
  - [3. 傅里叶分析 (`fourier.js`)](#3-傅里叶分析-fourierjs)
  - [4. 优化器 (`optimizer.js`)](#4-优化器-optimizerjs)
- [误差度量](#误差度量)
- [优化流程](#优化流程)
- [运行](#运行)
- [许可证](#许可证)

---

## 问题定义

### 输入

用户在画布上徒手绘制的封闭曲线（鼠标/触摸轨迹）。

### 输出

四连杆机构的 **9 个参数**，使得机构耦合点 P 的运动轨迹最大程度逼近用户绘制的目标曲线。

```
参数列表:
  O₂(x, y)  — 曲柄旋转中心 (地面枢轴 1)
  O₄(x, y)  — 摇杆旋转中心 (地面枢轴 2)
  a         — 曲柄长度 (O₂→A)
  b         — 连杆长度 (A→B)
  c         — 摇杆长度 (B→O₄)
  e         — 耦合点距离 (A→P)
  β         — 耦合角 (∠PAB, AP 与 AB 的夹角)
```

```
        P (耦合点, 画轨迹)
       /
      /e
     A-------B
     |  b    |
    a|       |c
     |       |
    O₂------O₄
        g      (地面连杆)
```

### 物理约束

| 约束 | 条件 | 含义 |
|------|------|------|
| **可装配性** | 最长杆 < 其余三杆之和 | 四杆能形成闭环 |
| **Grashof 曲柄-摇杆** | a 最短 且 a + c ≤ b + g | 曲柄能整周旋转, 耦合点轨迹闭合 |

不满足 Grashof 的机构也能生成轨迹，但曲柄无法转满 360°，轨迹有断点。

---

## 项目结构

```
track-generation/
├── index.html                          # 入口 HTML
├── vite.config.js                      # Vite 配置 (dev:6002 / preview:9966)
├── package.json                        # 依赖: Vue 3 + Vite
└── src/
    ├── main.js                         # Vue 应用入口
    ├── App.vue                         # 根组件
    ├── assets/main.css                 # 全局样式
    ├── engine/                         # ★ 计算引擎 (纯 JS, 无 Vue 依赖)
    │   ├── geometry.js                 # 几何工具: 坐标变换/重采样/PCA/距离
    │   ├── fourbar.js                  # 四杆运动学: 位置求解/耦合曲线/Grashof
    │   ├── fourier.js                  # 离散傅里叶变换: DFT + 相位引导对齐
    │   └── optimizer.js               # 核心优化器: DE + 坐标下降 + Pivot 精修
    ├── composables/                    # Vue 响应式状态层
    │   ├── useTrajectory.js            # 手绘轨迹状态
    │   ├── useLinkage.js               # 优化编排 + 预归一化
    │   └── useCanvas.js                # Canvas 渲染
    └── components/                     # Vue UI 组件
        ├── layout/AppLayout.vue        # 主布局
        ├── canvas/UnifiedCanvas.vue    # 绘图画布 + 机构可视化
        ├── panels/ControlPanel.vue     # 控制面板容器
        ├── panels/LinkagePanel.vue     # 优化按钮/参数表/误差显示
        └── ui/SliderControl.vue        # 通用滑块
```

---

## 计算管线

```
用户手绘曲线 points[]  (原始坐标)
  │
  ├─→ ensureClosed()         首尾距离 >1.5% 包围盒对角线 → 自动追加首点闭合
  │
  ├─→ normalizePoints()      预归一化: 质心→原点, 最大半径→1
  │     └─ 保存 {_normCenter, _normScale} 供结果反归一化
  │
  ├─→ fourier.computeDFT(3)  前 3 谐波 → f1Amp + k=1 相位缓存
  ├─→ geometry.computePCA()  协方差矩阵 → 主轴方向 + 跨度
  │
  └─→ buildBounds()          设定 9 个参数的 [min, max] 搜索边界
        │
        ▼
  ┌─ 差分进化 (DE) ──────────────────────────────┐
  │  NP=80, 100~140 代, DE/rand/1                 │
  │  每评估 → fourbar 求解 360 个角度位置         │
  │        → evaluateError() 计算混合误差         │
  ├─ 坐标下降 (CD) ──────────────────────────────┤
  │  对 DE 前 12 名候选者, 400~500 轮             │
  │  轴对齐贪婪下降, 随机参数顺序                 │
  │  收敛后 ±15% 扰动重启 ×2                     │
  ├─ Pivot 精修 ─────────────────────────────────┤
  │  固定 a/b/c/e/β, 仅搜索 O₂/O₄, 200 轮        │
  └──────────────────────────────────────────────┘
        │
        ▼
  最优 9 参数 + 误差 → 反归一化 → 渲染
        │
        ▼ (若设定了目标误差且未达标)
  optimizeContinue() → 小范围 DE → CD → Pivot精修 → 循环
```

---

## 模块详解

### 1. 四连杆运动学 (`fourbar.js`)

给定曲柄转角 θ₂，求解整个机构的位置。

```
输入: θ₂ (曲柄转角 0→2π)

步骤:
  1. A  = O₂ + a·(cos θ₂, sin θ₂)               ← 曲柄端点坐标
  2. d  = |O₄ − A|                                 ← A 到 O₄ 的距离
  3. cos φ = (b² + d² − c²) / (2·b·d)              ← 余弦定理 (△ABO₄)
  4. φ  = atan2(O₄−A)                              ← O₄A 基线方向
  5. γ  = acos(cos φ)                               ← 连杆 b 与基线 d 的夹角
  6. θ₃ = φ − γ                                    ← 连杆 AB 的绝对角度
  7. B  = A + b·(cos θ₃, sin θ₃)                  ← 连杆-摇杆铰接点
  8. P  = A + e·(cos(θ₃+β), sin(θ₃+β))           ← 耦合点 ★

对 360 个等间距 θ₂ 逐一求解 → 完整闭合耦合曲线
```

**函数说明**：

| 函数 | 作用 |
|------|------|
| `isAssemblable(a,b,c,gd)` | 三角形不等式——四杆能否装配 |
| `isGrashofCrankRocker(a,b,c,gd)` | Grashof 曲柄-摇杆条件——曲柄能否整周旋转 |
| `solveFourBar(a,b,c,θ,O₂,O₄)` | 单角度位置求解，无解返回 null |
| `couplerPoint(A,θ₃,e,β)` | 由连杆状态计算耦合点 P |
| `computeCouplerCurve(params, 360)` | 360 角度全扫描 → 完整耦合曲线 |
| `getLinkageState(params, θ)` | 获取单角度完整机构状态（供渲染） |

### 2. 几何工具 (`geometry.js`)

| 函数 | 用途 | 领域 |
|------|------|------|
| `cartesianToPolar` / `polarToCartesian` | 直角 ↔ 极坐标变换 | 坐标变换 |
| `centroid` | 点集质心（算术平均） | 计算几何 |
| `dist` / `distSq` | 两点欧氏距离 | 距离度量 |
| `boundingBox` | 轴对齐包围盒 (AABB) | 几何边界 |
| `cumulativeDistances` | 折线累积弦长 | 弧长参数化 |
| `resampleCurve` | 等弧长线性插值重采样 | 曲线参数化 |
| `normalizeCurve` | 平移至质心 + 缩放至单位最大半径 | 形状归一化 |
| `chamferDistance` | 两个点集的双向最近邻对称距离 | 形状匹配 |
| `closestPointOnSegment` | 点到线段的最近点（正交投影，t∈[0,1]） | 投影几何 |
| `computePCA` | 协方差矩阵 → 主轴/次轴方向及跨度 | 主成分分析 |
| `transformPoints` | 平移 + 均匀缩放 | 仿射变换 |
| `fitToBounds` | 等比缩放至指定矩形区域内 | 几何适配 |

### 3. 傅里叶分析 (`fourier.js`)

将 2D 封闭曲线视为复信号 `z[n] = x[n] + i·y[n]`，做离散傅里叶变换：

```
Z[k] = (1/N) · Σ z[n] · exp(−i·2π·k·n/N)

每个谐波 k 返回: { freq, re, im, amp, phase }
```

**两处应用**：

**① f1Amp 边界估计** (`buildBounds`)

k=1 谐波（基频）的幅度反映了曲线的主导尺度。将其用于设定曲柄长度 a 的搜索范围——幅度越大，曲线越大，a 的上限越高。

**② DFT 引导循环对齐** (`evaluateError`)

两条闭合曲线比较时，需要确定起始点的对应关系（相位对齐）。k=1 谐波的相位差给出最佳偏移的近似位置：

```
预计算: 目标曲线 k=1 相位 φ_target  (buildBounds 时缓存)
每次评估: 候选曲线 k=1 相位 φ_candidate

Δφ = φ_target − φ_candidate
est_shift = round(Δφ / (2π) × N)

在 [est−5, est+5] 邻域内逐偏移精确搜索 RMS 最小值
```

k=1 谐波捕捉了曲线的主导椭圆分量，其相位差对应了两条曲线的大致旋转偏移量。在估计值邻域内搜索确保了偏移对齐的精度，同时将搜索范围从全量程缩小到局部窗口。

### 4. 优化器 (`optimizer.js`)

#### 4.1 搜索边界 (`buildBounds`)

为 9 个优化参数设定 `[min, max]` 范围：

| 参数 | 边界设定方式 |
|------|-------------|
| O₂ | PCA 主轴跨度 ×0.6，不超过 maxR |
| O₄ | PCA 主轴跨度 ×0.9，不超过 1.5×maxR |
| a | f1Amp 辅助估算，自交曲线范围更宽 |
| b, c, e | maxR × [0.2, 3.0] 固定倍数 |
| β | [−π, π] 全范围 |

同时缓存目标曲线的 k=1 相位供后续 DFT 引导对齐使用。

#### 4.2 差分进化 (`differentialEvolution`)

全局搜索算法——不依赖梯度，通过种群竞争探索解空间。

```
DE/rand/1:
  种群规模 NP = 80
  迭代代数 = 100~140 (自交曲线 +40)
  
  每代对每个个体:
    随机选 3 个互异个体 a, b, c
    变异: trial = a + F × (b − c)    缩放因子 F ∈ [0.5, 0.9]
    交叉: 以 85% 概率采用 trial 的各维度
    选择: 若 trial 误差 < 当前个体误差 → 替换
```

初始化阶段加入两类启发式偏置：
- **PCA 偏置**：35% 概率将 O₂/O₄ 沿曲线主轴方向对向放置
- **自交曲线启发式**：30% 概率生成近似对称连杆配置

#### 4.3 坐标下降 (`coordinateDescent`)

局部精修——对 DE 输出的前 12 名候选者逐一打磨。

```
每轮遍历:
  随机打乱 9 参数顺序 (避免固定方向偏置)
  对每个参数:
    沿 ±δ 方向试探   (δ 初始 = 当前值的 6%)
    若改进 → 接受, δ 扩大 1.4 倍
  若全轮无改进 → 所有 δ 缩小 0.4 倍
  所有 δ < 1e-9 → 停止

收敛后 ±15% 扰动重启 ×2:
  对当前最优解施加随机扰动 → 从扰动点重新运行 CD
  若扰动点误差 > bestErr×5 → 跳过 (退化太严重)
  若重启找到更优解 → 替换
```

扰动重启机制使搜索能跳出浅层局部最优，探索相邻的误差盆地。

#### 4.4 Pivot 精修 (`refinePivots`)

固定已找到的连杆尺寸（a, b, c, e, β），仅对 O₂ 和 O₄ 的位置做更精细的坐标下降。

```
仅搜索 [o2x, o2y, o4x, o4y] 4 个变量
步长: 当前值的 2% (主 CD 为 6%)
迭代: 200 轮
```

连杆尺寸决定曲线的形状，pivot 位置决定曲线的定位——分阶段优化使两者各自收敛到最佳。

---

## 误差度量

`evaluateError(params, targetCurve)` 是优化过程的核心评估函数，每次候选参数都会被调用。

```
error = 0.6 × 循环对齐RMS + 0.4 × Chamfer距离 + Grashof惩罚
```

### ① 循环对齐 RMS（权重 60%）

两条闭合曲线需要先对齐起始点再逐点比较：

```
目标 k=1 相位 (预计算) → 候选 k=1 相位 → 估算最佳偏移
在 [est−5, est+5] 范围内逐偏移搜索:
  rms[shift] = √( Σᵢ ‖Pᵢ_target − Pᵢ₊shift_candidate‖² / N )
取 min(rms)
```

保留点的顺序——对 8 字形等自交曲线，顺序决定了曲线的拓扑结构，不能打乱。

### ② Chamfer 距离（权重 40%）

```
Chamfer(A,B) = avg(a∈A) min(b∈B) ‖a−b‖ + avg(b∈B) min(a∈A) ‖a−b‖
```

双向最近邻平均距离。补充 RMS 在形状覆盖度上的盲区——如果候选曲线只覆盖了目标曲线的部分区域，Chamfer 能从另一方向检测到。

### ③ Grashof 软惩罚

对非 Grashof 机构施加基于违反程度的连续惩罚，使误差地貌在可行域边界处平滑过渡：

```
violation = max(0, (最短杆 + 最长杆) − 其余两杆之和)
crankPenalty = (a 不是最短杆) ? 0.25 : 0
penalty = crankPenalty + 0.25 × (1 − exp(−violation / (gd × 0.05)))

范围: [0, 0.5]
```

采用 sigmoid 函数而非阶梯函数——惩罚随违反程度连续增长，保留了朝向可行域的梯度信息。

---

## 优化流程

### 预归一化

优化前将目标曲线一次性归一化到单位圆空间（质心原点，maxR=1）。所有 9 个参数在 [0, 1] 范围内搜索，统一了不同大小曲线的参数尺度。优化完成后将结果反归一化回原始坐标用于显示。

### 自动闭合

检测首尾点距离：若超过包围盒对角线的 1.5%，自动将首点追加到末尾形成闭合环。确保 DFT 的周期性假设成立（无频谱泄漏），同时保证误差度量的拓扑一致性（目标与候选均为闭合曲线）。

### 多轮自适应迭代

```
第 1 轮:
  DE(NP=80, 代数 100~140) → CD(400~500 轮) → Pivot精修(200 轮)

后续轮次 (若设定了目标误差且未达标):
  在当前最优解的 ±30% 范围内:
    DE(NP=40, 代数 60) → CD(300 轮) → Pivot精修(200 轮)
  循环直到误差达标或收敛停滞
```

后续轮次使用更小的种群和缩小的搜索范围，在已定位的盆地内进行更集中的探索。

---

## 运行

```bash
# 安装依赖
npm install

# 开发模式 (端口 6002)
npm run dev

# 生产构建
npm run build

# 预览构建产物 (端口 9966)
npm run preview
```

打开浏览器 → 在画布上绘制封闭曲线 → 输入目标误差 (可选) → 点击"自动优化"。

---

## 许可证

MIT
