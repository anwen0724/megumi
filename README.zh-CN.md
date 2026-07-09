# Megumi

[English](./README.md) | [简体中文](./README.zh-CN.md)

Megumi 是一个 local-first 的桌面 Coding Agent，用于处理真实代码库中的开发工作。

它把 Codex 风格的开发工作流带到桌面应用中：打开本地工作区，配置你自己的模型供应商，让 agent 理解项目、修改代码、运行验证命令，并在可见的会话时间线中跟踪它的工作过程。

Megumi 面向希望使用 agentic coding 工作流、同时保留本地工作区控制权的开发者。

## 为什么是 Megumi

Megumi 把 Codex 风格的 Coding Agent 工作流放进一个本地桌面应用里。

你不需要在聊天窗口、终端、编辑器和文件浏览器之间来回切换，而是可以在一个可见会话中和 agent 协作：让它理解代码库、检查相关文件、修改代码、运行验证命令，并解释发生了什么。

Megumi 的设计原则：

- 本地工作区是一等公民。
- 模型供应商由你自己选择。
- Agent 的动作会在运行过程中可见。
- 文件写入和命令执行需要经过审批。
- 会话、设置、运行时数据和日志默认保存在本地。
- Agent run 产生的工作区文件改动会在对话中追踪。

## 它能做什么

Megumi 设计用于支持 Coding Agent 的核心开发工作：

- 理解代码库：探索项目结构、读取相关文件、追踪实现路径，并解释系统如何组合在一起。
- 规划改动：拆解工程任务，分析取舍，并在编辑前提出实现步骤。
- 修改代码：实现功能、修复 bug、重构模块、更新测试，并在需要时调整文档。
- 使用工具：搜索文件、检查代码、编辑工作区、运行命令、执行测试并收集诊断信息。
- 系统化调试：阅读错误、复现失败、追踪根因、应用有针对性的修复，并验证结果。
- 审查工作：总结改动、识别风险、指出缺失测试，并帮助准备代码审查。
- 管理上下文：在一次 agent run 中携带项目指令、会话历史、工具结果、工作区状态和长任务上下文。
- 审批后执行：在敏感文件写入、命令执行或其它高影响操作前请求确认。

## 安装

Windows 用户可以从 GitHub Releases 下载最新安装包。

1. 下载最新的 `MegumiSetup.exe`。
2. 运行安装程序。
3. 启动 Megumi。
4. 在 Settings 中配置模型供应商。
5. 打开一个工作区，开始和 agent 协作。

当前 Windows 构建没有签名，因此 Windows SmartScreen 可能会显示 “Unknown publisher” 警告。

## 配置模型供应商

Megumi 使用用户自己配置的模型供应商。

在 Settings 中添加供应商时，需要配置：

- provider name
- protocol
- base URL
- API key
- model IDs

Megumi 当前主要面向 OpenAI-compatible provider APIs。

Provider settings 会保存在本地 Megumi home 目录下。

## 本地优先数据

Megumi 的本地应用数据保存在：

```text
~/.megumi
```

其中包括本地设置、会话、运行时数据库文件、日志和 provider 配置。

工作区操作发生在你的本机。Prompt 和相关工作区上下文只会发送给你配置的模型供应商。

## 开发

安装依赖：

```bash
npm install
```

启动桌面应用：

```bash
npm start
```

如果 Electron native modules 需要重建：

```bash
npm run start:fix-native
```

运行测试：

```bash
npm test
```

类型检查：

```bash
npx tsc --noEmit
```

打包应用：

```bash
npm run package
```

如果在 Electron 和 Node native module target 之间切换后测试失败，可以重建 Node native module：

```bash
npm run rebuild:native:node
```

## 仓库结构

```text
apps/desktop          Electron desktop app
packages/coding-agent Core coding agent runtime
packages/ai           Model provider protocol layer
tests                 Vitest test suite
```

## 贡献

欢迎贡献。

请保持改动聚焦，不要提交本地运行数据、密钥或私有文档，并在提交 PR 前运行测试。

## License

MIT License.
