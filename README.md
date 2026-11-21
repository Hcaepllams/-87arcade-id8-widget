# 87 ARCADE · ID8 仪表小组件

`render.js` 使用上游 Canvas 绘图，不依赖浏览器 DOM。网页模拟器和车端 `vehicle.js` 调用同一绘制函数。

- ROAD：四轮胎压、胎温分列左右；油温、水温竖排在中间。
- M SPORT：G 值图四角显示四轮胎压、胎温；下方显示横向/纵向与合成 G 值，底栏显示油温、水温。
- 两页顶部显示用户 Logo 下半部分的字标。底色透明，字标绘制时移除 PDF 导出的黑色衬底。
- ROAD 图层扩展到 1000×570@(620,125)，M SPORT 扩展到 800×527@(720,170)。两页保持中心位置及原有垂直留白，两侧胎压胎温向外展开。此宽度参考上游可见区域，最终裁切与原厂背景透出效果需要实车确认。
- 油水温仅用颜色提示：低温蓝色、正常白色、高温红色，无温度状态文字。预览沿用 M Vitals 默认阈值：油温 <70°C / ≥125°C，水温 <60°C / ≥112°C。不是厂家工作温度范围或已校准的车辆报警阈值。缺失或过期值显示灰色 `--`，不套用温度颜色。
- 无效/过期数据以 `--` 显示。G 值图坐标采用左正、加速正；上方为制动。超过图的 1 g 半径会把点限制在圆边，数字保留实际模拟值。

## 当前版本

沿用此前用户 ID8 实车确认过的垂直位置：ROAD / M SPORT 的 Logo 分别下移，轮位标签居中，SPORT 底部油温和水温居中。此目录不包含测试方块或诊断争用实验。

`vehicle.js` 根据车辆仪表模式切换布局，通过 cluster-render 的 `widget` 图片图层显示。`vehicle-data.js` 只读取 SOME/IP 温度、胎压和加速度信号，不发送 OBD / UDS 诊断请求。

配合本地 cluster-render 的 layout-focus-v2（300 毫秒）后，用户已确认模式切换能够恢复。该服务改动单独保存在 idrive-apps 仓库。v2.3 增加 Lifecycle.powerStateDetailed 的 Front 实例只读订阅，并通过 wakeWidget() 通知对应的本地 ID8 服务处理点火恢复；车端还需 Lifecycle 的 SOME/IP 配置。实际锁车恢复仍在验证。

## 文件与依赖

- `render.js`、`assets/`：两种布局与俱乐部 Logo。
- `vehicle.js`、`vehicle-data.js`：车端入口、信号转换与数据过期处理。
- `app.json`：本项目网页预览的应用描述，不是 MGU Store 安装清单。
- `*.test.js`：数据处理和模式切换时图层连续性的本地检查。

依赖 [idrive-apps](https://github.com/robertnisipeanu/idrive-apps) 的 cluster-render，以及 [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) 的 Canvas / signals 运行时。车端还需对应的 SOME/IP 接口定义及运行时依赖；它们未打包在本目录。此源码目录不是可直接安装的车机安装包。

车端默认从 `source/javascript/kit` 加载运行时，可用 `CLUB_KIT` 指定现有运行时目录。cluster-render 客户端从 `/var/opt/cluster-render/current/cluster_render_client` 加载。

## 本地检查

在当前开发工作区根目录运行（图层测试使用相邻的上游仓库）：

```sh
node apps/club-dashboard/vehicle-data.test.js
node apps/club-dashboard/vehicle-layout.test.js
node simulator/tests/check.js
```

网页预览说明见 `../../simulator/README.md`。本地测试不验证原厂仪表的选择记忆。

## 上传 GitHub

只上传本目录的源码、测试和 Logo 资源即可保留小组件代码；不要上传整个车辆调试工作区。车辆日志、接口目录导出、SSH 密钥、车机二进制和临时构建均不属于本小组件源码。Logo 为俱乐部提供的素材。

## 2026-11-21 实车验证与研究发现

用户确认 v2.3 锁车、解锁点火测试通过，普通/M 模式切换恢复也已通过。本结论限于本车本次测试。

显示请求 accepted、服务存活和图层存在，均不能证明仪表实际显示。v1 在 shown 后约 15 毫秒撤销 focus，随后约 351 毫秒被释放，因此闪现。保留 focus 改善部分启动过程。安全区 630×570→630×426→630×570 可以触发恢复，但另一次失败完全没有尺寸事件，单靠尺寸不够。

v2.3 只读订阅 Lifecycle.powerStateDetailed 的 Front 实例。经历 WELCOME_SCREEN、GOODBYE_SCREEN、SHUTDOWN_MODE_USER_OFF 或 SLEEP_MODE_ALL_OFF 后，下一次 FULL_ON_USER_ON 通过 widget-wake 协议触发恢复。300 毫秒后仍未显示时，撤销并重新启用已有 focus；点火恢复请求保留等待仪表安排显示。重复 FULL 和娱乐/全开状态波动不重复触发。服务会话中从未选过的组件不自动召回。

补丁 patches/cluster-render-v2.3.patch 基于 idrive-apps 提交 88e8554b1d81593d85f8095b4f0c38213223990d，包含服务、协议、JS 客户端和测试。应用后按上游 Makefile 编译。部署须同步更新 cluster-render-idrive8、cluster_render_client.js、vehicle.js，并在 runner 的 someipInterfaces 提供本车已有的 Lifecycle 只读配置。实验过程见 patches/WIDGET-RESTORE-TEST.md。

目前选择记录保存在服务内存，重启服务后普通与 M 模式需各选择一次。长期休眠、冷启动持久化、手动改选原厂组件的完整回归仍待完成。本仓库不包含车辆接口导出、日志、密钥和车机库。

### 公开资料复核

上游确实已经提醒了部分机制。README 记载 ID8 会在切换布局时收回组件，作者观察到 1–7 秒后恢复，并说明 focus 自动请求与可见区域。这些信息应更早落实到我们的测试设计中。本车启动后持续不恢复的结果也说明，不能把作者的恢复时间当作每辆车的保证。
https://github.com/robertnisipeanu/idrive-apps/blob/main/native/cluster-render/README.md

PR #59 于 2026-11-04 讨论场景被移除后的重试、KOMBI 尚未准备好和等待导致的延迟。作者明确测试于 iDrive 7，涉及场景 fetch，不能直接认定为本次 ID8 Lifecycle/DCSM 的同一修复。
https://github.com/robertnisipeanu/idrive-apps/pull/59

本轮未找到明确要求通过 Lifecycle 的 FULL_ON_USER_ON 恢复 ID8 启动安全带页面后 widget 的相同公开实现，搜索结果不足以证明全网没有。
