# Engineering — portrait-webgpu-base

配套：[AGENTS.md](../AGENTS.md) · [ENTRYPOINTS.md](./ENTRYPOINTS.md) · [MERGE.md](./MERGE.md) · [AUDIO.md](./AUDIO.md) · [HAPTICS.md](./HAPTICS.md) · [ROTATE-RINGS.md](./ROTATE-RINGS.md) · [PARTS.md](./PARTS.md) · [ROTATE-RINGS-SOURCES.md](./ROTATE-RINGS-SOURCES.md)

## 1. 定位

可复制的 **竖屏 WebGPU 手游底座**：能 dev、能 build、能真机、能震动、桌面≈手机/Pad。打开后试玩 `public/levels/1.json`：环可转，杆可滑，银卡扣锁定。最后一件离场约 1 秒后弹出结算，重玩或下一关，第 5 关回到第 1 关。设置里打开关卡模式才编辑 1 到 5 关。保存只写当前摆法。对齐按钮才把左右两列收到同一条横坐标，已有目标的柄心再对准，不把环心拽去凑柄。外形见 [PARTS.md](./PARTS.md)，规则、跟手、结算和编辑见 [ROTATE-RINGS.md](./ROTATE-RINGS.md)。

## 2. 目录

```
portrait-webgpu-base/
├── AGENTS.md
├── README.md
├── docs/
├── index.html
├── vite.config.ts          # base: './' · port 5190
├── capacitor.config.ts     # contentInset never · scrollEnabled false
├── src/
│   ├── main.ts             # 舞台、灯光、阴影
│   ├── game/               # 零件、关卡、编辑、跟手、掉落。规则见 ROTATE-RINGS.md
│   ├── create-renderer.ts
│   ├── style.css
│   ├── adapt/
│   │   ├── design.ts       # 390×844 · layout · clientToDesign
│   │   ├── devicePreview.ts
│   │   └── safeArea.ts
│   └── utils/haptics.ts
├── public/levels/          # 1.json … 5.json。开发时由编辑器写回
├── plugins/native-haptics/ # Swift 真源
└── scripts/bootstrap-ios.mjs
```

## 3. 配置表

### Vite

| 项 | 值 | 原因 |
|----|-----|------|
| `base` | `'./'` | Capacitor 相对路径 |
| `outDir` | `dist` | = webDir |
| `port` | `5190` | 固定端口 |
| `target` | `es2022` | WebGPU |

### Capacitor

| 项 | 值 |
|----|-----|
| `appId` | 在 `capacitor.config.ts` 自定，避免和真机已装 App 冲突 |
| `webDir` | `dist` |
| `ios.contentInset` | `never` |
| `ios.scrollEnabled` | `false` |
| `ios.backgroundColor` | `#0b1020` |

### 设计尺寸

| 常量 | 值 |
|------|-----|
| DESIGN_WIDTH / HEIGHT | 390 / 844 |
| DESIGN_SAFE top/bottom | 59 / 34（桌面模拟） |
| Phone 预览 | 390×844 |
| Pad 预览 | 768×1024（外层视口） |

改设计尺寸时同步：`design.ts`、`style.css` 中 `#stage` 宽高、`index.html` 若有硬编码。

## 4. 适配算法

```
scale = min(viewW/390, viewH/844)   // contain
offset = 居中
#stage transform: translate(offset) scale(scale)
renderer.setSize(390, 844)          // 始终设计分辨率
```

触控：画布矩形换到设计坐标，再换到正交视口。按下忽略设计画面外。拖动中指针捕获继续跟踪，滑出画面不丢。点选、短窗口和套筒补齐见 [ROTATE-RINGS.md](./ROTATE-RINGS.md) §4「意图」，跟手公式在同一节。

## 5. Safe Area

| 环境 | 行为 |
|------|------|
| 桌面 | JS 写入 `--safe-*` = DESIGN_SAFE |
| 原生 | 去掉 inline，CSS `env(safe-area-inset-*)` |
| UI | `#ui-root` padding = safe + ui-pad |

3D 可全出血；可点 UI 只在 `#ui-root`。

## 6. WebGPU

- `createRenderer` → `three/webgpu` WebGPURenderer  
- 无 `navigator.gpu` / init 失败 → `showFatal`  
- DPR cap 默认 2  
- 禁止 `setSize(innerWidth, innerHeight)` 跟窗走  

## 7. Haptics

接线规范：[HAPTICS.md](./HAPTICS.md)

真源：`plugins/native-haptics/`  
JS：`src/utils/haptics.ts`（`registerPlugin('AdvancedHaptics')`）  
注册链路（Capacitor 8 真机已验通）：

```
SceneDelegate.rootViewController = BridgeViewController()
  → capacitorDidLoad
  → registerPluginInstance(AdvancedHapticsPlugin)
```

`ios:bootstrap` 会拷 Swift、改 storyboard、**改 SceneDelegate**、补 pbx。只 `cap:sync` 不够。

只改 storyboard **不够**：Capacitor 8 用 SceneDelegate 直接 `CAPBridgeViewController()`，会绕过 storyboard，HUD 出现 `plugin: false`，按钮无震。

Swift **没有** `prepare`；引擎在 `load()` 启动。UIKit 反馈在主线程触发。验收用 HUD **点我震动**（`impact`）和状态行 `plugin: true`。  
试玩三种震写在 `src/game/play.ts`：按下碰到零件、带动后再撞、抬手解开。时机见 [ROTATE-RINGS.md](./ROTATE-RINGS.md) §4。短震播放器的复用在 `plugins/native-haptics/`，改完要 `ios:bootstrap`。

## 7b. Audio（尚未实现）

本仓库无播放代码。接入规范见 [AUDIO.md](./AUDIO.md)：

- Loading **预解码**；热路径禁止 `new Audio()` / decode / 读盘
- `AudioBatcher`：**每帧最多一次** Capacitor 桥
- iOS 生产走 `AVAudioEngine` + PCM 缓存 + PlayerNode 池；**禁止**静默 WebAudio
- Catalog 管 cooldown / priority / maxVoices；忙帧再砍每帧条数

## 8. iOS 工作流

```bash
# 首次
npm install && npm run ios:bootstrap && npm run cap:open

# 日常
npm run cap:sync
```

## 9. 已知坑

1. **不要**把 `base` 改回 `'/'`  
2. **不要** `contentInset: automatic`（双重 inset）  
3. Pad 预览禁止横向拉满 390 UI  
4. pbxproj 优先 bootstrap，少手改  
5. `dist` / `ios/.../public` 是产物  
6. 真机安装前改 `capacitor.config.ts` 的 `appId`，避免覆盖别的 App  
7. 震动没接上：先看 [HAPTICS.md §0](./HAPTICS.md)。常见断点是 SceneDelegate 仍是默认 VC，不是 storyboard 没改。不要只 `cap:sync`，不要用 `prepare()` 当验收  

## 10. 变更

| 日期 | 说明 |
|------|------|
| 2026-08-03 | 初版：合并 niantu + shell 为 portrait-webgpu-base |
| 2026-08-14 | 增加 AUDIO.md：音效不卡帧方案 |
| 2026-08-14 | 增加 HAPTICS.md：震动一次接对 |
| 2026-10-28 | 柄只写在 `connectors`。读档丢掉 `catch:` 旧销。撞击火花见 ROTATE-RINGS §7 |
| 2026-10-28 | 跟手吃同一事件里的合并采样。抬手补齐 2%。长条碎块横向散开。碎块按当前画面下沿删除。试玩四种震动 |
| 2026-10-29 | 试玩改为三种震：按下碰到零件、带动后再撞、抬手解开。夸奖字留在画面内。编辑的对齐和保存分开 |
| 2026-08-31 | 真机震动验通。根因：Capacitor 8 `SceneDelegate` 绕过 storyboard。bootstrap 现会改 SceneDelegate；HUD 用「点我震动」+ `plugin` 标志验收 |
