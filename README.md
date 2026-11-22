# 87 ARCADE · ID8 仪表小组件

`render.js` 使用上游 Canvas 绘图，不依赖浏览器 DOM。网页模拟器和车端 `vehicle.js` 调用同一绘制函数。

- ROAD：四轮胎压、胎温分列左右；油温、水温竖排在中间。
- M SPORT：G 值图四角显示四轮胎压、胎温；下方显示横向/纵向与合成 G 值，底栏显示油温、水温。
- 两页顶部显示用户 Logo 下半部分的字标。底色透明，字标绘制时移除 PDF 导出的黑色衬底。
- ROAD 图层扩展到 1000×570@(620,125)，M SPORT 扩展到 800×527@(720,170)。两页保持中心位置及原有垂直留白，两侧胎压胎温向外展开。此宽度参考上游可见区域，最终裁切与原厂背景透出效果需要实车确认。
- 油水温仅用颜色提示：低温蓝色、正常白色、高温红色，无温度状态文字。预览沿用 M Vitals 默认阈值：油温 <70°C / ≥125°C，水温 <60°C / ≥112°C。不是厂家工作温度范围或已校准的车辆报警阈值。缺失或过期值显示灰色 `--`，不套用温度颜色。
- 无效/过期数据以 `--` 显示。G 值图坐标采用左正、加速正；上方为制动。超过图的 1 g 半径会把点限制在圆边，数字保留实际模拟值。

## 当前架构

`widget.js` 提供绘图函数、信号声明与数据转换。`framework/widgets/runtime.js` 负责连接、仪表模式和刷新，`manager.js` 统一启动已注册组件并监听车辆电源状态。修改后的 cluster-render 统一处理各模式的选择记忆、切换恢复与启动恢复。新组件无需复制这套恢复逻辑。

组件名称为 **87 Arcade**，菜单缩略图使用 `assets/preview.png` 中的完整俱乐部 Logo。`app.json` 同时声明名称、缩略图与组件入口。它不是 MGU Store 安装清单。

当前仓库保留根目录的 87 Arcade 应用，公共代码放在 `framework/widgets/`。工作区原来的 apps/club-dashboard 路径在本仓库对应根目录。独立运行入口 `vehicle.js` 默认加载本仓库的公共 runtime，也支持 `WIDGET_RUNTIME`。车端实际由 manager 启动 runtime 与 widget.js。

架构、注册方法和组件接口见 [框架说明](framework/widgets/README.md)。注册表持久保存 target/content/scene 标识，移除后重装保留原标识。每种仪表模式的组件选择单独持久保存，默认文件为 `/var/opt/cluster-render/state/widget-selection.txt`。选择变化时使用临时文件、fsync 和原子替换保存，服务启动时读回。

## 构建与部署依赖

依赖 [idrive-apps](https://github.com/robertnisipeanu/idrive-apps) 的 cluster-render 与 [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) 的 Canvas/signals。车端还需要车辆已有的 SDK、原生模块和只读 SOME/IP 接口定义，包含 Lifecycle 的 Front 实例。本仓库不分发这些车辆资源，也不是直接安装包。

当前补丁 [cluster-render-v3.patch](patches/cluster-render-v3.patch) 基于 idrive-apps 提交 `88e8554b1d81593d85f8095b4f0c38213223990d`，累计包含 v2.3 与持久化、多组件注册和公共恢复改动。在该上游提交应用补丁后，必须构建并同步部署 **cluster-render 启动器和 cluster-render-idrive8**，以及补丁中的 JS 客户端。启动器也解析配置，旧版会拒绝新增的 remember 设置。v2.3 补丁仅保留为历史记录，不与 v3 叠加应用。

公共管理器通过 apps 根目录与持久注册表启动组件。注册工具生成 renderer 配置，名称与缩略图路径由组件 manifest 提供。车端目录应保留注册表与选择文件，且 renderer 的 hmi_5000 用户必须有选择目录写权限。不要在每次开机时灌入默认选择。

## 本地检查

框架状态与注册测试、数据测试可直接运行：

```sh
node framework/widgets/check.js
node vehicle-data.test.js
```

图层测试需要两个上游源码目录，默认查找本仓库旁边的 idrive-apps 与 idrive7-apps，也可显式指定：

```sh
IDRIVE_APPS=/path/to/idrive-apps IDRIVE7_APPS=/path/to/idrive7-apps node vehicle-layout.test.js
```

原生测试随 v3 补丁提供，包含两个独立进程保存/重新读取选择的入口。先构建 dcsm27_port_test，再以 `--save-selection FILE` 写入，退出后以 `--restore-selection FILE` 验证读取与恢复请求。显示服务完整测试的结果与限制见框架说明。

网页模拟器位于原开发工作区，未复制到本仓库。应用绘图不依赖浏览器 DOM，模拟器与车端共享 render.js。

## 2026-11-22 车端更新与发现

旧 v2.3 把选择保存在内存。短时锁车测试通过不能证明整车完整休眠后恢复，之前把这项功能视为完成是验收遗漏。此次启动日志显示组件已注册，但切换模式时报告 no recorded selection，恢复请求未发出。

本次已部署公共 manager/runtime/lifecycle、稳定组件注册、持久选择和完整 Logo 缩略图。沿用已登记的自启服务，将其入口改为 manager，未同时启动旧单组件入口。新进程加载两个模式的选择，300ms 后请求显示，并收到 DCSM shown。注册与选择文件分开保存，后续组件共用恢复机制。

生命周期观察器首次读到 FULL_ON_USER_ON 即请求本轮恢复，连接尚未握手完成时保留该事件。欢迎、告别、关机或休眠后再次点火会产生下一轮恢复，重复 FULL 不重复触发。选择文件允许启动时不依赖前一个进程内存恢复。

此次服务重启后的恢复已获协议反馈，完整整车休眠后的自动恢复，以及名称/缩略图的实物外观仍待用户实车确认。DCSM shown、服务存活或请求 accepted 均不能替代实际画面确认。

现有 DCSM hide/release 无法单独区分用户主动选择原厂页面与系统临时覆盖，改选原厂组件后的保留仍需实车回归。此前 v1 的短时 focus 撤销导致闪现、安全区变化不一定发生等发现保留在 [历史实验记录](patches/WIDGET-RESTORE-TEST.md)。

仓库仅包含源码、测试、补丁和俱乐部提供的 Logo。车辆日志、密钥、车辆接口导出、二进制与构建产物均不提交。

### 公开资料复核

上游确实已经提醒了部分机制。README 记载 ID8 会在切换布局时收回组件，作者观察到 1–7 秒后恢复，并说明 focus 自动请求与可见区域。这些信息应更早落实到我们的测试设计中。本车启动后持续不恢复的结果也说明，不能把作者的恢复时间当作每辆车的保证。
https://github.com/robertnisipeanu/idrive-apps/blob/main/native/cluster-render/README.md

PR #59 于 2026-11-04 讨论场景被移除后的重试、KOMBI 尚未准备好和等待导致的延迟。作者明确测试于 iDrive 7，涉及场景 fetch，不能直接认定为本次 ID8 Lifecycle/DCSM 的同一修复。
https://github.com/robertnisipeanu/idrive-apps/pull/59

本轮未找到明确要求通过 Lifecycle 的 FULL_ON_USER_ON 恢复 ID8 启动安全带页面后 widget 的相同公开实现，搜索结果不足以证明全网没有。
