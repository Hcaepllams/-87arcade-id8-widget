# 87 ARCADE · ID8 仪表小组件

`render.js` 使用上游 Canvas 绘图与离线烘焙字体（`assets/fonts/arcade-num.json`、`arcade-label.json`，Barlow Semi Condensed Bold/SemiBold），不依赖浏览器 DOM。网页模拟器和车端 `vehicle.js` / `widget.js` 调用同一绘制函数。

## 布局与视觉（2026-11-25 实车标定版）

- **ROAD（`1120 × 660 @ (560, 125)`，5 fps）**：左右两栏布局，顶部 `y < 152` 完整避让 CarPlay 导航条。左栏显示四轮胎压（66px 粗体一位小数）与胎温（36px），下方居中放置放大后的 `87 ARCADE` 字标（224 × 94）；右栏撑满全高显示 7 项动力数据（油温、水温、变速箱油温、进气温度、机油压力、高压燃油压力、涡轮增压）及进度条。
- **SPORT（`760 × 556 @ (774, 170)`，10 fps）**：按实车硬裁切线与左侧亮蓝斜边标定为紧凑三栏。左栏显示四轮胎压胎温与下方 `87 ARCADE` 字标（150 × 63）；中栏为放大的 G 仪表（半径 108，含红点、2 秒渐隐轨迹、本次驾驶金色极值凸包）与正下方 48px 合成 G；右栏取消进度条，单排清晰显示 7 项动力数据。
- **协调暗底衬**：数据区背后在静态缓存层绘制深海蓝半透明圆角底衬（`#050d1888`）与细描边，栏间及顶部导航净区保持全透明。
- **温度与缺失规则**：油水温沿用低温蓝 / 正常白 / 高温红提示（原型默认阈值：油温 `<70°C / ≥125°C`，水温 `<60°C / ≥112°C`，非原厂标定报警阈值）；缺失或过期值降暗显示 `--`。G 值图坐标采用左正、上方制动、下方加速。

## 数据采集与常驻诊断

- **被动 SOME/IP**：油温/水温（CDS）、四轮胎压胎温（TPMS）、横纵向 G（CDS2）、仪表模式（Vehicle2）及实际涡轮增压（FES `displayBoostPressure`）。
- **常驻只读诊断（`diag-probe.js`）**：默认运行 `ID8_DIAG_MODE=live`，仅在组件可见（`shown`）且处于有效点火电源状态时，每 1.5 秒向 DME 发送一条单帧只读 UDS `0x22` 请求，读取 5 个 S58 实车验证 DID（`0x580F` 进气温度、`0x586F` 机油绝压与 `0x4201` 大气压折算表压、`0x5658` 高压燃油压力、`0x4650` 变速箱油温）。诊断读数保鲜期 15 秒，每 60 秒输出一条轻量汇总。
- **模式与日志控制**：设置 `ID8_DIAG_MODE=probe` 可切回六阶段对照实验，设置 `ID8_DIAG_PROBE=0` 可关闭主动诊断；设置 `ID8_DIAG_LOG` 可将 JSONL 日志写入指定文件（超过 5 MiB 自动轮转为 `.1`）。
- **G 极值持久化（`g-history.js`）**：对本次驾驶凸包做 `0.01 g` 量化并上限 64 个角向顶点，通过 `framework/widgets/state.js` 原子持久化保存，按熄火休眠或系统重启开启新一轮驾驶统计。

## 当前架构

`widget.js` 提供绘图函数、信号声明、数据转换与诊断探针入口。`framework/widgets/runtime.js` 负责连接、仪表模式切换（ROAD 5 fps / SPORT 10 fps）和按区域分块脏矩形 RGBA 上传（将 SPORT 10 fps 峰值带宽压低至约 1,935 KiB/s，低于 5,500 KiB/s 预算）；`manager.js` 统一启动已注册组件并转发 `lifecycle.js` 的车辆电源状态。修改后的 cluster-render 统一处理各模式的选择记忆、切换恢复与启动恢复。

组件名称为 **87 Arcade**，菜单缩略图使用 `assets/preview.png` 中的完整俱乐部 Logo。`app.json` 同时声明名称、缩略图与组件入口，不是 MGU Store 安装清单。

当前仓库保留根目录的 87 Arcade 应用，公共代码放在 `framework/widgets/`。独立运行入口 `vehicle.js` 默认加载本仓库的公共 runtime，也支持 `WIDGET_RUNTIME`。车端实际由 manager 启动 runtime 与 `widget.js`。

架构、注册方法和组件接口见 [框架说明](framework/widgets/README.md)。注册表持久保存 target/content/scene 标识，移除后重装保留原标识。每种仪表模式的组件选择单独持久保存，默认文件为 `/var/opt/cluster-render/state/widget-selection.txt`。选择变化时使用临时文件、fsync 和原子替换保存，服务启动时读回。

## 构建与部署依赖

依赖 [idrive-apps](https://github.com/robertnisipeanu/idrive-apps) 的 cluster-render 与 [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) 的 Canvas/signals。车端还需要车辆已有的 SDK、原生模块和只读 SOME/IP 接口定义（包含 Lifecycle 的 Front 实例及诊断所需接口）。本仓库不分发这些车辆资源，也不是直接安装包。

离线字体图集由 `tools/bake-fonts.py` 生成，如需重新烘焙可传入本地 TTF 目录：`python3 tools/bake-fonts.py /path/to/fonts`。

当前补丁 [cluster-render-v3.patch](patches/cluster-render-v3.patch) 基于 idrive-apps 提交 `88e8554b1d81593d85f8095b4f0c38213223990d`，累计包含 v2.3 与持久化、多组件注册和公共恢复改动。在该上游提交应用补丁后，必须构建并同步部署 **cluster-render 启动器和 cluster-render-idrive8**，以及补丁中的 JS 客户端。v2.3 补丁仅保留为历史记录，不与 v3 叠加应用。

## 本地检查

状态、注册、数据、G 历史与诊断调度测试可直接运行：

```sh
node framework/widgets/check.js
node vehicle-data.test.js
node g-history.test.js
node diag-probe.test.js
```

图层与带宽测试需要两个上游源码目录，默认查找本仓库旁边的 `idrive-apps` 与 `idrive7-apps`，也可显式指定：

```sh
IDRIVE_APPS=/path/to/idrive-apps IDRIVE7_APPS=/path/to/idrive7-apps node vehicle-layout.test.js
```

网页模拟器位于原开发工作区，未复制到本仓库。应用绘图不依赖浏览器 DOM，模拟器与车端共享 `render.js`。

## 2026-11-25 更新记录

- **诊断共存与常驻化**：实车 6 分钟路试中单帧 5-DID 只读 UDS `0x22` 与外接方向盘诊断设备稳定共存，遂切为常驻 `live`（1.5 秒节拍、15 秒保鲜期、去除 30 秒退避），涡轮增压改走被动 `FES.displayBoostPressure`。
- **脏矩形上传与 G 历史控体积**：`runtime.js` 改为横向三分区脏矩形 RGBA 打包上传，实车限流降至 0；`g-history.js` 采用 0.01 g 量化和 64 顶点上限，避免长时驾驶状态文件膨胀。
- **UI 实车标定**：升级 700/600 粗体离线字库与深海蓝半透明暗底衬；普通模式放大左栏字标至 224 px；运动模式按实车硬裁切线收进 `760 × 556 @ (774, 170)`，左栏四轮加字标、中栏放大 G 图、右栏取消进度条以消除超框。上述 `20261125-v3` 版本已部署车端，运动模式新边界与长时路试稳定性待次日实车复测。

## 2026-11-22 车端更新与复盘记录

持久化遗漏的模型记录、原因、披露情况和验收教训保留在 [选择记忆错误复盘](docs/POSTMORTEM-20261122.md)。2026-11-23 已获实车隔夜断电记忆恢复确认。此前 v1 的实验记录保留在 [历史实验记录](patches/WIDGET-RESTORE-TEST.md)。

仓库仅包含源码、测试、补丁、离线字库与俱乐部提供的 Logo。车辆日志、密钥、车辆接口导出、二进制与构建产物均不提交。
