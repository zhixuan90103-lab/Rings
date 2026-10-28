# Rotate Rings · 有效来源

日期：2026-10-27  
方法规范：[ROTATE-RINGS.md](./ROTATE-RINGS.md)  
范围：开口环、闭合环与长条滑杆。不含松果、道具。  
规则以实机为准：拖动只改角度，抬手才结算，拖动中即使已经对齐也不离场。解开后按 ROTATE-RINGS.md §7 碎裂离场，不原地消失。

攻略站、物理论文、同名异核仓库不进本表。

## 规则

| 来源 | 钉住什么 |
|------|----------|
| 实机（2026-10-26） | 拖动只改角度；抬手才结算；拖动中已经对齐也不离场 |
| `../Rotate Rings游戏分析/Rotate-Rings-游戏分析.md` | 零件、拖动中可见的阻挡、清盘过关 |
| 拆解重点摘要（同日对话） | 不能删的七条：单目标、绕心转、缺口对齐、未解则停、自动离场、清盘、顺序是解 |
| [MDN Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) | `pointerdown` 起捕获，`pointerup` / `pointercancel` 结束。只用于手势会话 |
| [MDN `setPointerCapture`](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture) | 手指滑出元素后仍收到移动 |
| [MDN `getCoalescedEvents`](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents) | 一次 `pointermove` 里被合并的中间点按顺序补上 |
| [Apple HIG · Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures) | 拖移是直接操作，反馈跟上手指。系统「旋转」是双指，不是单指绕圆心 |

## 实现

| 来源 | 钉住什么 |
|------|----------|
| [MDN `Math.atan2`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/atan2) | 缺口是否盖住关节，以及网格的 `rotation.z`。不拿它做跟手增量 |
| [Three.js Raycaster](https://threejs.org/docs/pages/Raycaster.html) | 点选。`intersectObjects` 按距离从近到远 |
| [three.js `Raycaster.js`](https://github.com/mrdoob/three.js/blob/master/src/core/Raycaster.js) | 排序实现比较 `distance` |
| [rawify/Angles.js](https://github.com/rawify/Angles.js) | `between(n, a, b)`：角可以跨过 0，用来判断缺口是否盖住关节 |
| [davidfig/angle](https://github.com/davidfig/angle) | `shortestAngle`、`normalize`，同一类圆周运算 |

## 读过并排除

| 来源 | 原因 |
|------|------|
| [Three.js DragControls](https://threejs.org/docs/pages/DragControls.html) 与 [DragControls.js](https://github.com/mrdoob/three.js/blob/master/examples/jsm/controls/DragControls.js) | 旋转绕相机上轴和右轴，不绕环心，也不夹禁区 |
| [TransformControls.js](https://github.com/mrdoob/three.js/blob/master/examples/jsm/controls/TransformControls.js) | 沿手柄轴转，不处理关节 |
| [JoltPhysics.js 合页](https://github.com/jrouwe/JoltPhysics.js/blob/main/JoltJS.idl) | 连续刚体约束，不是抬手结算 |
| [sat-js](https://github.com/jriecken/sat-js) | 凸多边形是否重叠，回答不了还能转多少 |
| [d3-shape `arc.js`](https://github.com/d3/d3-shape/blob/main/src/arc.js)、[@thi.ng/geom-arc](https://github.com/thi-ng/umbrella/blob/develop/packages/geom-arc) | 只负责画弧 |
| [Hungarian-Rings](https://github.com/grigorusha/Hungarian-Rings)、[GeraniumsPot](https://github.com/grigorusha/GeraniumsPot) | 相交圆上的置换谜题，点击步进 |

## 没有外部来源的定案

写在 [ROTATE-RINGS.md](./ROTATE-RINGS.md)。限位销只挡角度，而且 `stopHalf > 0`。银卡扣是套筒卡扣：形体挡住环，不留环，也不挡自己的杆；整根杆身离开固定点才解除。窗口卡扣只留给销钉关。把手抬手要缺口对准并且柄已离开实心。阻挡销和把手才是可删连接。闭合环靠连锁离场。解开后才碎裂，碎块不推动仍上锁的零件。

同日后续定案，仍无外部来源：画面上的交叉必须是规则上的卡住；关卡要有拆解先后，后一根杆被前面还在盘上的环挡住。抬手未解开则停在原处。吸附容差、重叠命中的产品规则，本表没有来源。

2026-10-27 跟手定案：圆环用切向弧长，杠杆是 `max(|r|, 环带半径)`。长条只加沿长边的位移。被挡住的位移丢掉，不追手指。按下只收设计画面内的点，拖动中滑出画面仍跟踪。
