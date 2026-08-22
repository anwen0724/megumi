# Megumi

[English](./README.md) | [简体中文](./README.zh-CN.md)

**一个把日常会话中产生的关注信号，转化为持续、主动、个性化内容发现的个人 Agent。**

[![平台：Windows](https://img.shields.io/badge/平台-Windows-5f6b7a)](#快速开始)
[![使用 TypeScript 构建](https://img.shields.io/badge/构建-TypeScript-3178c6)](https://www.typescriptlang.org/)
[![许可证：MIT](https://img.shields.io/badge/许可证-MIT-4c7a68)](./LICENSE)

![Megumi 桌面界面](./assets/screenshots/startup-screen.png)

## 关于 Megumi

Megumi 是一个以本地桌面应用形态提供的开源个人 Agent。用户可以在日常工作、学习和兴趣探索中持续与它交流；在用户授权的范围内，Megumi 从这些会话以及后续推荐反馈中提取有依据的关注信号，理解用户当前和长期真正关注什么。

Megumi 利用这种理解主动跨来源发现内容，过滤重复与噪声，说明每条内容为什么值得关注，并根据反馈调整后续发现。用户不需要维护静态领域、关键词或订阅源。

当前代码已经提供这一产品方向所需的本地、供应商无关 Agent 基座，包括通用执行循环、上下文、工具、权限、Sandbox、持久化会话和可观察的运行过程。

## Agent 基座

```mermaid
flowchart LR
    U["用户输入"] --> H["Harness：Input 与 Context"]
    H --> E["Agent Core / Agent Loop"]
    E --> A["AI 模型"]
    A --> E
    E --> T["Harness：Tools"]
    T --> P["Permissions"]
    P --> S["Sandbox"]
    S --> W["本地工作区"]
    H --> M["Session 与产品状态"]
    E --> V["Events 与 Observability"]
```

- **Agent Core** 拥有与产品场景无关的 Agent Loop，以及单次 Agent Execution 的显式生命周期。
- **Context** 使用 Instructions、会话历史、工作区事实、Skills 和当前模型调用可用的工具，构建供应商无关的模型上下文。
- **AI** 为支持的模型协议提供统一调用接口，并将模型流式输出交回 Agent Core。
- **Tools、Permissions 与 Sandbox** 负责路由行动、判断行动是否允许或需要审批，并强制执行真实影响范围。
- **Session、产品状态与运行事件** 在核心循环之外提供持久化历史、产品行为和可观察的执行过程。

## 快速开始

Megumi 当前提供 Windows 桌面应用。

1. 从 [GitHub Releases](https://github.com/anwen0724/megumi/releases) 下载安装程序。
2. 启动 Megumi 并打开一个本地工作区。
3. 在设置中配置模型供应商和凭据。
4. 选择模型并开始会话。

## 模型配置

Megumi 通过以下 API 协议接入模型供应商：

- OpenAI Completions
- OpenAI Responses
- OpenAI Codex Responses
- Anthropic Messages
- Google Generative AI

应用内提供内置供应商和模型目录。自定义供应商可以使用受支持的 API 协议、Base URL、Model ID 和 Credential 进行配置。

本地应用数据保存在：

```text
~/.megumi
```

## 从源码构建

环境要求：

- Windows 10 或 Windows 11
- 当前 Node.js LTS 版本和 npm
- Git

安装依赖并启动桌面应用：

```bash
npm ci
npm start
```

执行项目检查：

```bash
npm run typecheck:packages
npm run typecheck:product
npm test
```

构建未打包应用目录或 Windows 安装程序：

```bash
npm run package
npm run make
```

Electron Forge 将构建输出写入 `out/`。

## 仓库结构

```text
apps/desktop           Electron 桌面宿主与用户界面

packages/
├── product            产品装配、Host 接口与整体生命周期
├── engine             Run 生命周期与 Agent Loop
├── input              用户输入与附件处理
├── commands           显式命令识别与处理
├── context            Prompt 构建、上下文预算与压缩
├── ai                 供应商无关模型接口与 Provider Adapter
├── tools              工具注册、路由与执行
├── permissions        行动授权与审批判断
├── sandbox            文件、进程与网络的强制执行边界
├── session            语义历史、Entry 与会话分支
├── workspace          工作区访问与变更记录
├── instructions       基础指令与有效指令来源
├── skills             Skill 发现、加载与选择
├── settings           产品配置与模型供应商凭据
├── database           数据库 Schema、迁移与事务
├── events             Runtime Event 协议与 EventBus
├── projections        从运行和会话事实生成的读取模型
└── observability      Trace、Log、Measurement 与诊断

tests/                 自动化测试与架构守卫
assets/                项目公开展示与 README 资源
```

## 致谢

Megumi 的模型供应商接入层基于 [`pi` 的 AI Package](https://github.com/earendil-works/pi)，并根据 Megumi 支持的供应商范围和桌面装配方式进行了适配。

## 许可证

Megumi 使用 [MIT License](./LICENSE)。
