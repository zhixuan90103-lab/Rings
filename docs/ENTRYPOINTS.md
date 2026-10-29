# 入口与调用链

## 1. 命令

| 命令 | 结果 |
|------|------|
| `npm run dev` | http://127.0.0.1:5190/ |
| `npm run build` | `tsc` 检查 + `dist/`（相对路径） |
| `npm run cap:sync` | build + cap sync ios |
| `npm run ios:bootstrap` | add ios + 拷插件 + 改 storyboard **和 SceneDelegate** + pbx + sync |
| `npm run ios` | sync + open Xcode |

## 2. Web 启动链

```
index.html
  → style.css
  → main.ts
       → applyNativeClass / safeArea
       → createRenderer(#stage)
       → mountPlay（切向转环、沿长边滑杆，银卡扣锁定）
       → 试玩页 mountPlaySession；编辑页 editor.html 才 mountEditor
       → mountDevicePreview → computeStageLayout → applyStageTransform
       → watchStageLayout
       → haptics + HUD buttons
```

## 3. DOM

```
#shell
  #viewport
    #app
      #stage
        canvas
        #ui-root
          header.hud
          #result          过关结算，默认 hidden
          #dock            #status 只留编辑提示
#device-switcher / #device-label   (web only)
```

## 4. iOS

震动插件 **不会**随 `cap:sync` 自动注册。第一次 / 改插件必须 `ios:bootstrap`。步骤见 [HAPTICS.md §0](./HAPTICS.md)。

```
ios:bootstrap
  → 拷 plugins/native-haptics → ios/App/App
  → Main.storyboard customClass = BridgeViewController
  → SceneDelegate.rootViewController = BridgeViewController()   ← Capacitor 8 必改
Xcode Run 真机
  → SceneDelegate 创建 BridgeViewController
  → capacitorDidLoad → registerPluginInstance(AdvancedHapticsPlugin)
  → load App/public (= dist)
  → 同上 Web 链
  → HUD「点我震动」→ haptics.impact('medium')
```

HUD 状态行有 `plugin: true/false`。`false` = 仍在默认 `CAPBridgeViewController`，插件未进 JS `PluginHeaders`。

## 5. 改配置找谁

| 要改 | 文件 |
|------|------|
| base / 端口 | `vite.config.ts` |
| appId | `capacitor.config.ts` |
| 设计分辨率 | `design.ts` + `style.css` |
| 震动原生 | `plugins/native-haptics/*.swift` + bootstrap |
| 启动 HUD | `index.html` + `main.ts` |
| 关卡编辑 | 电脑页 `editor.html`。`src/game/editor.ts`、`src/game/levelio.ts`、`public/levels/`。保存只在 `npm run dev` |
| 过关结算 | `play.ts` 计时后 `onCleared`；`result.ts` 弹出 `#result`。重玩再开当前关，下一关向后，第 5 关回到第 1 关 |
| 编辑镜头 | `camera.ts` 的 `editorFrame`。编辑栏「镜头」「上下」两条滑杆 |
| 音效（规划） | [AUDIO.md](./AUDIO.md) |
| 震动接线 | [HAPTICS.md](./HAPTICS.md) |
