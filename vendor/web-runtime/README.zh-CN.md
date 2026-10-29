# OpenBone 网页运行时 0.2

[English](README.md) | [简体中文](README.zh-CN.md)

现在提供两条明确的浏览器播放路线，均无需 JVM 或编辑器连接：

- **Spine 官方 WebGL 集成**：需要官方完整功能时使用 [official/README.md](official/README.md)。直接使用固定版本的 4.2／4.3 官方 reader、AnimationState 和渲染器，支持官方混合、linked mesh、sequence、双色等能力；保留官方许可。
- **独立 OpenBone Runtime**：`src/index.js` 无 Spine 依赖，已补齐 Java 基线中的 IK／变换／路径／60Hz 物理约束、裁剪、五种继承、皮肤激活、加权路径与变形，并提供独立的混合／序列／双色扩展。

功能矩阵与本机源码证据见 [CAPABILITIES.md](CAPABILITIES.md)。独立实现不宣称完整兼容所有 Spine。没有修改 DSH 插件。

## 启动

```powershell
npm.cmd --prefix web-runtime/official ci --ignore-scripts --no-audit --no-fund
npm.cmd --prefix web-runtime/official run build
npm.cmd --prefix web-runtime run demo
```

官方播放器：<http://127.0.0.1:8127/web-runtime/official/>；独立播放器：<http://127.0.0.1:8127/web-runtime/demo/>。固定端口被占用时明确报错。开发服务器提供整个仓库，部署时应使用普通静态服务器，仅提供需要的文件。

支持 `current.json` 资源包、单独 JSON／`.skel`／`.skel.bytes` 与配套 atlas。保留 atlas 贴图相对路径，通过 HTTP(S) 提供资源。独立实现覆盖 Java 实际契约内的稳定 3.8、4.0、4.1、4.2、4.3 格式；官方实现直接匹配 4.2／4.3，旧格式可通过现有格式适配器进入 4.2。未知版本、原生 `.spine` 和 OpenBone 可编辑工程不作为运行时数据直接加载。

资源包先校验 manifest 与全部文件 SHA-256，再解码贴图；SHA 用于字节一致性，不是发布者签名。资源限制、API、坐标和销毁契约见英文说明与 TypeScript 声明。`assets.source.version` 保留输入版本，`RUNTIME_INFO` 区分实现身份。

物理按 Java 的 60Hz 固定步重放，子帧仅显示已有状态；倒退跳转、换动画、换皮肤和循环接缝保持可复现。物理重放上限为 600 秒／36,000 步。独立混合接口采用局部姿态先混合再求约束；完整 Spine AnimationState 语义使用官方适配器。

## 已执行验证

39 个 Java 场景、五个格式族的 JSON／二进制对照、全部皮肤、循环与重复／倒退跳转；真实 Chrome WebGL 共 800 帧和 19,320 项骨骼数值比较；另有 132 组官方 4.2／4.3 JSON／二进制渲染，以及官方 sequence、linked mesh 变形、双色、跨动画混合、多轨叠加和销毁检查。

证据：`target/web-runtime-browser-receipt.json`、`target/web-runtime-capabilities.png`、`target/web-runtime-smoke.png`。使用 ANGLE／SwiftShader，属于真实浏览器 WebGL；尚未验证移动设备、Safari、Firefox、上下文恢复或生产性能。可复现命令见英文说明。
