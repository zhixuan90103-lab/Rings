# AGENTS.md — portrait-webgpu-base

> **打开本仓库时的第一入口。**  
> 合并自 **niantu**（适配/TS/预览）+ **three-webgpu-cap-shell**（打包/文档/bootstrap/可验证 demo）。

## 一句话

**TypeScript + Three.js WebGPU + Vite + Capacitor iOS** 竖屏手游稳健底座。  
设计空间固定 **390×844**，contain letterbox；桌面可切手机/Pad 预览；`base: './'` 保证真机资源路径。

## 入口地图

| 职责 | 文件 |
|------|------|
| Web 启动 | `index.html` → `src/main.ts`。手机和真机只走这一页 |
| 关卡编辑页 | `editor.html` → 同一个 `src/main.ts`。只在电脑上用 |
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
| 当前操作 | `src/game/play.ts` 与 `board.ts`。环绕自己的中心转：环带上跟夹角，孔内按环带半径折算，圆心上、下方的上下滑按左右侧跟手指方向。杆沿长边滑动，银卡扣锁定。按下碰到零件、带动后再撞、提示亮开始变亮、抬手解开各震一次。无效晃动不震。过关约 1 秒后由 `main.ts` 弹出 `#result` |
| 手机设置 | `src/game/phoneSettings.ts`。试玩页右上角齿轮只开震动测试和四档手感 |
| 关卡编辑 | 电脑页 `editor.html`。菜单在手机框外。试玩页和真机没有编辑。规范见 `docs/ROTATE-RINGS.md` §9 |
| 规则 | `docs/ROTATE-RINGS.md`。试玩读 `public/levels/`。打包时由 `src/game/packedLevels.ts` 收进程序 |

## DOM（勿拆）

```
#shell > #viewport > #app > #stage
  canvas          ← WebGPU
  #ui-root        ← 所有游戏 UI（safe padding）
#device-switcher  ← 仅桌面预览例外
#editor-desk      ← 仅 editor.html。在手机框外，不跟 390×844 缩放
#edit-link        ← 仅宽屏试玩页，链到 editor.html
```

## 硬性约定

1. **`vite` `base: './'`** — Capacitor 禁止绝对 `/assets/`  
2. **`webDir: dist`** 与 Vite `outDir` 一致  
3. **`ios.contentInset: never`** — Safe Area 只走 CSS  
4. **布局坐标 390×844**；禁止 `renderer.setSize(window.innerWidth,…)`  
5. **玩法 UI 只挂 `#ui-root`**。编辑侧栏 `#editor-desk` 和「编辑关卡」链接是仅有的框外例外，不进真机包的操作路径  
6. **Pad 只改外层视口**，不改 `DESIGN_*`  
7. **改 Swift 改 `plugins/native-haptics/`** 再 `ios:bootstrap`；震动接线见 `docs/HAPTICS.md`。Capacitor 8 的 `SceneDelegate` 必须 `rootViewController = BridgeViewController()`（默认 `CAPBridgeViewController` 不会注册插件）。不要用 JS `prepare()` 判断是否接上；真机 HUD 看 `plugin: true` + 点「点我震动」。  
8. **无 WebGPU 则明确失败**，不静默 WebGL  
9. **系统手势按 [docs/ENGINEERING.md](docs/ENGINEERING.md) §5b**。网页禁选字放大镜、长按菜单和系统缩放，不拦 `touchstart`。四边推迟和 WebView 回弹在 `BridgeViewController`，改 Swift 后要重编。便捷访问（底边向下把整页降到下半屏）没有公开接口，不能在 App 里关  

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
- 操作：`src/game/play.ts` 收指针，`src/game/intent.ts` 定拖谁，`src/game/board.ts` 算环的转角和沿长边的位移。银卡扣不进拖动。柄只在 `connectors`，读档丢掉 `catch:` 旧销。体积关按重叠变深退回，销钉关用禁区弧。跟手和意图以 `docs/ROTATE-RINGS.md` §4 为准  
- 规则：`docs/ROTATE-RINGS.md` 与 `src/game/`。试玩读 `public/levels/`。手写关仍在 `levels.ts`  
- 编辑：只改 `editor.ts`、`levelio.ts` 和 `packedLevels.ts`。电脑页 `editor.html`。柄用 `{ angle, stem, target }`。选中后拖十字移动、拖外圈旋转。网格默认开，位置吸 `0.1`，旋转吸 15°。加手柄先点生长位置，再点把手位置。保存只写当前摆法。左右对齐是单独的按钮。手机齿轮不进编辑，规则以 `docs/ROTATE-RINGS.md` §9 为准  
- 保留：adapt / create-renderer / haptics / plugins / `base`  
- 触控：`clientToDesign` + 忽略 letterbox 外  
- 音效：按 `docs/AUDIO.md` 接入；禁止热路径 `new Audio()` / 每发一次桥  

## 刻意不做

- 把竖杆、横柄写进圆环网格。再加一套衔接，往 `connectors` 里加一项 `{ angle, stem, target }`  
- 银卡扣接到环的衔接上。卡扣只叠在胶囊棍中点，滑动时锁在画面上，不走场景投影，也不跟棍滑动。这根棍离场时，卡扣从锁住的位置一起掉落  
- Android（可后加）  
- WebGL 静默回退  
