# 87 ARCADE · ID8 仪表小组件

`render.js` 使用上游 Canvas 绘图与离线烘焙字体（`assets/fonts/arcade-num.json`、`arcade-label.json`，Barlow Semi Condensed Bold/SemiBold），不依赖浏览器 DOM。网页模拟器和车端 `vehicle.js` / `widget.js` 调用同一绘制函数。

## 布局与视觉（2026-11-26 实车验证版）

- **ROAD（`1120 × 660 @ (560, 125)`，5 fps）**：左中右三栏严格中轴对称布局，顶部 `y < 152` 完整避让 CarPlay 导航条，全部主数值与标签命中原生烘焙字号（56px / 30px / 20px），车机 Node v8.16.2 缓存帧耗时约 14 ms：
  - 左栏（`x = 48..362`）：油温、水温、变速箱油温、进气温度 4 行铺满全高，配 274px 满宽进度条。
  - 中栏（`x = 376..744`，中心 `x = 560`）：四轮胎压（56px 一位小数）与胎温（30px），下方绝对居中放置 220 × 92 的 `87 ARCADE` 字标。
  - 右栏（`x = 758..1072`）：机油压力、高压燃油压力、涡轮增压 3 行与左栏镜像对称，配 274px 满宽进度条（BOOST 保留零刻度线）。
- **SPORT（`760 × 556 @ (774, 170)`，10 fps）**：按实车硬裁切线与左侧亮蓝斜边标定为紧凑三栏，缓存帧耗时约 7 ms。左栏显示四轮胎压胎温与下方 `87 ARCADE` 字标（150 × 63）；中栏为放大的 G 仪表（半径 108，含红点、2 秒渐隐轨迹、本次驾驶金色极值凸包）与正下方 48px 合成 G；右栏取消进度条，单排清晰显示 7 项动力数据。
- **协调暗底衬**：数据区背后在静态缓存层绘制深海蓝半透明圆角底衬（`#050d1888`）与细描边，栏间及顶部导航净区保持全透明。
- **温度与缺失规则**：油水温沿用低温蓝 / 正常白 / 高温红提示（原型默认阈值：油温 `<70°C / ≥125°C`，水温 `<60°C / ≥112°C`，非原厂标定报警阈值）；缺失或过期值降暗显示 `--`。G 值图坐标采用左正、上方制动、下方加速。

## 数据采集与温和共存诊断

- **被动 SOME/IP**：油温/水温（CDS）、四轮胎压胎温（TPMS）、横纵向 G（CDS2）、仪表模式（Vehicle2）及实际涡轮增压（FES `displayBoostPressure`）。
- **常驻只读诊断（`diag-probe.js`）**：默认运行 `ID8_DIAG_MODE=live`，仅在组件可见（`shown`）且处于有效点火电源状态时，向 DME (`0x12`) 发送单帧只读 UDS `0x22` 请求，读取 5 个 S58 实车验证 DID（`0x580F` 进气温度、`0x586F` 机油绝压与 `0x4201` 大气压折算表压、`0x5658` 高压燃油压力、`0x4650` 变速箱油温）。
- **温和共存策略（不卡外接方向盘转速灯）**：成功回包后按 **3 秒**常态节拍调度（把 93% 以上 OBD 通道时间留给外接方向盘设备）；遇到 `tasReject` / 超时 / 传输错误后，从完成时刻起按非等距序列 **`1370 / 1890 / 2410 / 1630 ms`** 轮换等待（彻底打破零间隔重发引发的 20 分钟锁相，同时留出 1.4 到 2.4 秒的通道恢复窗）；诊断读数保鲜期 **25 秒**；记录精简 `live_sample` 与每分钟 `live_summary`（含 `maxConsecRej` 和 `maxOkGapMs`）。
- **模式与日志控制**：设置 `ID8_DIAG_MODE=probe` 可切回六阶段对照实验，设置 `ID8_DIAG_PROBE=0` 可关闭主动诊断；设置 `ID8_DIAG_LOG` 可将 JSONL 日志写入指定文件（超过 5 MiB 自动轮转为 `.1`）。
- **G 极值持久化（`g-history.js`）**：对本次驾驶凸包做 `0.01 g` 量化并上限 64 个角向顶点，通过 `framework/widgets/state.js` 原子持久化保存，按熄火休眠或系统重启开启新一轮驾驶统计。

## 当前架构

`widget.js` 提供绘图函数、信号声明、数据转换与诊断探针入口。`framework/widgets/runtime.js` 负责连接、仪表模式切换（ROAD 5 fps / SPORT 10 fps）和按横向三分区脏矩形 RGBA 上传（与普通模式三栏区间天然对齐，SPORT 10 fps 峰值带宽约 1,935 KiB/s，低于 5,500 KiB/s 预算）；`manager.js` 统一启动已注册组件并转发 `lifecycle.js` 的车辆电源状态。修改后的 cluster-render 统一处理各模式的选择记忆、切换恢复与启动恢复。

组件名称为 **87 Arcade**，菜单缩略图使用 `assets/preview.png` 中的完整俱乐部 Logo。`app.json` 同时声明名称、缩略图与组件入口，不是 MGU Store 安装清单。

架构、注册方法和组件接口见 [框架说明](framework/widgets/README.md)。注册表持久保存 target/content/scene 标识，移除后重装保留原标识。每种仪表模式的组件选择单独持久保存，默认文件为 `/var/opt/cluster-render/state/widget-selection.txt`。

## 构建与部署依赖

依赖 [idrive-apps](https://github.com/robertnisipeanu/idrive-apps) 的 cluster-render 与 [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) 的 Canvas/signals。车端还需要车辆已有的 SDK、原生模块和只读 SOME/IP 接口定义（包含 Lifecycle 的 Front 实例及诊断所需接口）。本仓库不分发这些车辆资源，也不是直接安装包。

离线字体图集由 `tools/bake-fonts.py` 生成，如需重新烘焙可传入本地 TTF 目录：`python3 tools/bake-fonts.py /path/to/fonts`。

当前补丁 [cluster-render-v3.patch](patches/cluster-render-v3.patch) 基于 idrive-apps 提交 `88e8554b1d81593d85f8095b4f0c38213223990d`，累计包含 v2.3 与持久化、多组件注册和公共恢复改动。在该上游提交应用补丁后，必须构建并同步部署 **cluster-render 启动器和 cluster-render-idrive8**，以及补丁中的 JS 客户端。

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

## 更新记录

- **2026-11-26（ROAD 方案 B + 温和共存 `v5` 实车通过）**：将普通模式重构为左 4 温度 / 中 4 胎加居中字标 / 右 3 压力三栏中轴对称布局并全部命中原生烘焙字号（车机缓存渲染提速至 14 ms）；针对全天通勤日志定位的 3.25 秒拒帧锁相问题及外接方向盘转速灯滞后现象，将常驻 `live` 调整为 3 秒常态节拍、拒帧完成时刻起 `1370/1890/2410/1630 ms` 错相退让与 25 秒保鲜期，经实车测试通过。
- **2026-11-25**：实车 6 分钟路试验证单帧 5-DID 只读 UDS `0x22` 与外接设备共存，涡轮增压改走被动 `FES.displayBoostPressure`；上线三分区脏矩形 RGBA 上传、64 顶点 G 包络、粗体字库与 SPORT 实车硬裁切标定。
- **2026-11-22**：部署公共框架与选择记忆持久化，复盘记录保留在 [选择记忆错误复盘](docs/POSTMORTEM-20261122.md)，历史实验保留在 [历史实验记录](patches/WIDGET-RESTORE-TEST.md)。

仓库仅包含源码、测试、补丁、离线字库与俱乐部提供的 Logo。车辆日志、密钥、车辆接口导出、二进制与构建产物均不提交。
