# Megumi

[English](./README.md) | [简体中文](./README.zh-CN.md)

**一个面向 Windows 的个人桌面 Agent。**

打开真实代码库，接入你自己的模型供应商，让 Megumi 检查文件、修改代码、运行命令并验证结果；整个过程都会显示在可追踪的会话时间线中。

[![状态：预览版](https://img.shields.io/badge/状态-预览版-d8a24a)](#项目状态)
[![平台：Windows](https://img.shields.io/badge/平台-Windows-5f6b7a)](#开发)
[![许可证：MIT](https://img.shields.io/badge/许可证-MIT-4c7a68)](./LICENSE)
[![使用 TypeScript 构建](https://img.shields.io/badge/构建-TypeScript-3178c6)](https://www.typescriptlang.org/)

**本地工作区 · BYOK 模型 · 可见工具执行 · 审批控制 · English / 简体中文界面**

![Megumi——个人桌面 Agent](./assets/social-preview.png)

## 为什么是 Megumi

Megumi 是一个在本地桌面应用中与你协作的个人 Agent。

你不需要在聊天窗口、终端、编辑器和文件浏览器之间来回切换，而是可以在一个可见会话中和 agent 协作：让它理解代码库、检查相关文件、修改代码、运行验证命令，并解释发生了什么。

Megumi 的设计原则：

- 本地工作区是一等公民。
- 模型供应商由你自己选择。
- Agent 的动作会在运行过程中可见。
- 文件写入和命令执行会经过权限策略，并在需要时请求审批。
- 会话、设置、产品数据和日志默认保存在本地。
- Agent run 产生的工作区文件改动会在对话中追踪。
- 桌面界面支持 English 和简体中文切换。

## 它能做什么

当前预览版提供以下能力：

- 理解代码库：探索项目结构、读取相关文件、追踪实现路径，并解释系统如何组合在一起。
- 规划改动：拆解工程任务，分析取舍，并在编辑前提出实现步骤。
- 修改代码：实现功能、修复 bug、重构模块、更新测试，并在需要时调整文档。
- 使用工具：搜索文件、检查代码、编辑工作区、运行命令、执行测试并收集诊断信息。
- 系统化调试：阅读错误、复现失败、追踪根因、应用有针对性的修复，并验证结果。
- 审查工作：总结改动、识别风险、指出缺失测试，并帮助准备代码审查。
- 管理上下文：为每次模型调用组合项目指令、当前会话历史、本次 run 的工具结果、滚动摘要和选定工具集合。
- 审批后执行：在敏感文件写入、命令执行或其它高影响操作前请求确认。
- 延续历史工作：恢复本地会话历史、切换分支，并在长对话中执行上下文压缩，同时不把纯运行时执行状态持久化为业务事实。
- 使用图片输入：当所选模型支持图片能力时，可从本地文件或剪贴板附加图片。
- 诊断运行过程：查看本地 activity、Context 使用量、Provider usage、错误信息和脱敏诊断包。

## 项目状态

Megumi 正在持续开发，目前处于 Windows 早期预览阶段。预览安装包通过 [GitHub Releases](https://github.com/anwen0724/megumi/releases) 发布。如果 Releases 中暂时没有安装包，可以按照下方步骤从源码启动。

当前 Windows 构建尚未签名，因此安装时可能触发 Windows SmartScreen 的“Unknown publisher”提示。继续安装前请先核对 Release Notes 和源码。

## 在 Windows 上安装

1. 打开 [GitHub Releases](https://github.com/anwen0724/megumi/releases)。
2. 从最新 Release 下载 `Megumi-<version> Setup.exe`。
3. 运行安装程序。如果出现 SmartScreen，请先阅读发布者警告，再决定是否继续。
4. 启动 Megumi，选择语言和主题，添加本地项目，并配置模型供应商。

Megumi 当前以 Windows 为正式目标平台。仓库虽然包含其它平台的 Electron Forge maker，但 macOS 和 Linux 暂未进入受支持的公开发布流程。

## 配置模型供应商

Megumi 使用用户自己配置的模型供应商。

在 Settings 中添加供应商时，需要配置：

- provider name
- protocol
- base URL
- API key
- model IDs

Megumi 当前通过 OpenAI-compatible Adapter 提供 DeepSeek 与 OpenAI 模型目录，也支持配置自定义 OpenAI-compatible 地址和模型 ID。Anthropic 协议 Adapter 尚未实现。

Provider settings 会保存在本地 Megumi home 目录下。

## 本地优先数据

Megumi 的本地应用数据保存在：

```text
~/.megumi
```

其中包括本地设置、会话、业务数据库文件、日志和 provider 配置。

工作区操作发生在你的本机。Prompt 和相关工作区上下文只会发送给你配置的模型供应商。

## 开发

环境要求：

- Windows 10 或 Windows 11
- 当前维护中的 Node.js LTS 版本和 npm
- Git

安装依赖：

```bash
npm ci
```

启动桌面应用：

```bash
npm start
```

运行测试：

```bash
npm test
```

类型检查：

```bash
npx tsc --noEmit
```

生成未安装的应用目录：

```bash
npm run package
```

生成 Windows 安装包：

```bash
npm run make
```

Electron Forge 会把构建产物写入 `out/`。Windows 下可分发的 Squirrel 安装程序位于 `out/make/squirrel.windows/x64/`。

发布 Release 前至少运行：

```bash
npm test
npx tsc --noEmit
npm run make
```

## 仓库结构

```text
apps/desktop          Electron desktop app
packages/agent        Core agent runtime
packages/product      Product host interface and composition
packages/ai           Model provider protocol layer
tests                 Vitest test suite
```

## 贡献

欢迎贡献。

请保持改动聚焦，不要提交本地运行数据、密钥或私有文档，并在提交 PR 前运行测试。

## License

MIT License.
