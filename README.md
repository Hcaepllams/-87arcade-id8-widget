# 87 ARCADE · ID8 仪表小组件

`render.js` 使用上游 Canvas 绘图，不依赖浏览器 DOM。网页模拟器和车端 `vehicle.js` 调用同一绘制函数。

- ROAD：四轮胎压、胎温分列左右；油温、水温竖排在中间。
- M SPORT：G 值图四角显示四轮胎压、胎温；下方显示横向/纵向与合成 G 值，底栏显示油温、水温。
- 两页顶部显示用户 Logo 下半部分的原图字标。
- 油水温仅用颜色提示：低温蓝色、正常白色、高温红色，无温度状态文字。预览沿用 M Vitals 默认阈值：油温 <70°C / ≥125°C，水温 <60°C / ≥112°C。不是厂家工作温度范围或已校准的车辆报警阈值。缺失或过期值显示灰色 `--`，不套用温度颜色。
- 无效/过期数据以 `--` 显示。G 值图坐标采用左正、加速正；上方为制动。超过图的 1 g 半径会把点限制在圆边，数字保留实际模拟值。

## 当前版本

保留已在用户 ID8 实车确认可见的布局：ROAD / M SPORT 的 Logo 分别下移，轮位标签居中，SPORT 底部油温和水温居中。此目录不包含测试方块或诊断争用实验。

`vehicle.js` 根据车辆仪表模式切换布局，通过 cluster-render 的 `widget` 图片图层显示。`vehicle-data.js` 只读取 SOME/IP 温度、胎压和加速度信号，不发送 OBD / UDS 诊断请求。

已知问题：切换仪表样式后，小组件不能自动恢复，需要手动重新选择。未宣称解决选择记忆或冷启动恢复问题。

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
