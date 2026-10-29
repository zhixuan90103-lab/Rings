# AGENTS.md — portrait-webgpu-base

> **打开本仓库时的第一入口。**  
> 合并自 **niantu**（适配/TS/预览）+ **three-webgpu-cap-shell**（打包/文档/bootstrap/可验证 demo）。

## 一句话

**TypeScript + Three.js WebGPU + Vite + Capacitor iOS** 竖屏手游稳健底座。  
设计空间固定 **390×844**，contain letterbox；桌面可切手机/Pad 预览；`base: './'` 保证真机资源路径。

## 入口地图

| 职责 | 文件 |
|------|------|
| Web 启动 | `index.html` → `src/main.ts` |
| 设计舞台 | `src/adapt/design.ts` |
| 设备预览 | `src/adapt/devicePreview.ts` |
| Safe Area | `src/adapt/safeArea.ts` + `src/style.css` |
| WebGPU | `src/create-renderer.ts` |
| 震动 JS | `src/utils/haptics.ts` |
| 震动 Swift 真源 | `plugins/native-haptics/*` |
| 震动怎么接 | `docs/HAPTICS.md` **§0 正确接入** |
| Capacitor | `capacitor.config.ts`（`contentInset: never`） |
| 构建 | `vite.config.ts`（**`base: './'`**） |
| iOS 注入 | `scripts/bootstrap-ios.mjs` |
| 音效方案（未实现） | `docs/AUDIO.md` |
| 画面零件 | `src/game/parts.ts`，规范见 `docs/PARTS.md` |
| 当前操作 | `src/game/play.ts` 与 `board.ts`。环按切向弧长绕自己的中心转，杆沿长边滑动，银卡扣锁定。按下碰到零件、带动后再撞、抬手解开各震一次。无效晃动不震。过关约 1 秒后由 `main.ts` 弹出 `#result` |
| 关卡编辑 | `src/game/editor.ts`、`levelio.ts`。设置里打开关卡模式才出现。规范见 `docs/ROTATE-RINGS.md` §9 |
| 规则 | `docs/ROTATE-RINGS.md`。试玩读 `public/levels/1.json` |

## DOM（勿拆）

```
#shell > #viewport > #app > #stage
  canvas          ← WebGPU
  #ui-root        ← 所有游戏 UI（safe padding）
#device-switcher  ← 仅桌面预览例外
```

## 硬性约定

1. **`vite` `base: './'`** — Capacitor 禁止绝对 `/assets/`  
2. **`webDir: dist`** 与 Vite `outDir` 一致  
3. **`ios.contentInset: never`** — Safe Area 只走 CSS  
4. **布局坐标 390×844**；禁止 `renderer.setSize(window.innerWidth,…)`  
5. **UI 只挂 `#ui-root`**；禁止玩法 UI `position: fixed` 贴浏览器窗  
6. **Pad 只改外层视口**，不改 `DESIGN_*`  
7. **改 Swift 改 `plugins/native-haptics/`** 再 `ios:bootstrap`；震动接线见 `docs/HAPTICS.md`。Capacitor 8 的 `SceneDelegate` 必须 `rootViewController = BridgeViewController()`（默认 `CAPBridgeViewController` 不会注册插件）。不要用 JS `prepare()` 判断是否接上；真机 HUD 看 `plugin: true` + 点「点我震动」。  
8. **无 WebGPU 则明确失败**，不静默 WebGL  

## 命令

```bash
npm install
npm run dev           # http://127.0.0.1:5190/
npm run build
npm run cap:sync
npm run ios:bootstrap # 首次 / 修插件
npm run ios
```

查询参数：`?preview=0|1` · `?debugFit=1`  
调试安全区：`document.body.classList.add('debug-safe-area')`

## 业务怎么加

- 零件外形和组合：改 `src/game/parts.ts`，并同步 `docs/PARTS.md`。已定稿的尺寸、倒角、颜色不要跟着操作改  
- 操作：`src/game/play.ts` 收指针，`src/game/intent.ts` 定拖谁，`src/game/board.ts` 算切向转角和沿长边的位移。银卡扣不进拖动。柄只在 `connectors`，读档丢掉 `catch:` 旧销。体积关按重叠变深退回，销钉关用禁区弧。跟手和意图以 `docs/ROTATE-RINGS.md` §4 为准  
- 规则：`docs/ROTATE-RINGS.md` 与 `src/game/`。试玩读 `public/levels/`。手写关仍在 `levels.ts`  
- 编辑：只改 `editor.ts` 和 `levelio.ts`。柄用 `{ angle, stem, target }`。保存只写当前摆法。左右对齐是单独的按钮，规则以 `docs/ROTATE-RINGS.md` §9 为准  
- 保留：adapt / create-renderer / haptics / plugins / `base`  
- 触控：`clientToDesign` + 忽略 letterbox 外  
- 音效：按 `docs/AUDIO.md` 接入；禁止热路径 `new Audio()` / 每发一次桥  

## 刻意不做

- 把竖杆、横柄写进圆环网格。再加一套衔接，往 `connectors` 里加一项 `{ angle, stem, target }`  
- 银卡扣接到环的衔接上。卡扣只叠在胶囊棍中点，滑动时锁在画面上，不走场景投影，也不跟棍滑动。这根棍离场时，卡扣从锁住的位置一起掉落  
- Android（可后加）  
- WebGL 静默回退  
