# Megumi Python 后端

Megumi 是一个跨平台内容发现 Agent 的后端实现（Python 3.12 + FastAPI）。

当前状态：**第 1 阶段——工程骨架**。服务可以被启动、能响应健康检查、能干净退出；业务能力后续按功能逐步加入。

## 运行前需要你执行的命令

```bash
# 1. 安装 uv（一次性；如果你已经装过可以跳过）
pip install uv

# 2. 进入后端目录并安装依赖（会创建 .venv 虚拟环境）
cd backend
uv sync

# 3. 启动服务
uv run python -m megumi run
```

启动成功后终端会输出一行 `server.listening`，其中包含实际监听的地址（默认随机端口，只监听本机）。然后在**另一个终端**验证：

```bash
curl http://127.0.0.1:<上面输出的端口>/health
# {"status":"ok","version":"0.1.0","home":"C:\\Users\\<你>\\.megumi"}
```

按 `Ctrl+C` 停止；正常退出码为 0。

## 其他命令

```bash
uv run python -m megumi --help          # 查看命令
uv run python -m megumi doctor          # 检查环境（不启动服务）
uv run python -m megumi run --port 8420 # 指定端口
```

## 代码检查与测试

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run pytest
```

## 配置

全部通过环境变量读取，都有默认值：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MEGUMI_HOME` | `<用户目录>/.megumi` | 本地数据根目录（设置、数据库、日志、附件） |
| `MEGUMI_HOST` | `127.0.0.1` | 监听地址，默认只允许本机访问 |
| `MEGUMI_PORT` | `0` | 监听端口；`0` 表示由系统分配空闲端口 |
| `MEGUMI_LOG_LEVEL` | `info` | `critical` / `error` / `warning` / `info` / `debug` |
| `MEGUMI_LOG_FORMAT` | `console` | 控制台格式：`console` 可读文本、`json` 结构化 |

日志会同时写入 `<MEGUMI_HOME>/logs/backend.jsonl`（每行一个 JSON），控制台按 `MEGUMI_LOG_FORMAT` 渲染。

## 目录结构

```text
backend/
├── pyproject.toml            # 依赖与工具链配置（相当于 pom.xml）
├── src/megumi/
│   ├── __init__.py           # 版本号
│   ├── __main__.py           # python -m megumi 入口
│   ├── cli.py                # 命令行：run / doctor
│   ├── app.py                # 组合根：创建与释放资源（相当于 Spring 容器）
│   ├── config.py             # 读取环境变量配置
│   ├── errors.py             # 错误模型：带错误码的异常
│   ├── lifecycle.py          # 资源释放栈（逆序释放）
│   ├── logging_setup.py      # 结构化日志
│   ├── paths.py              # Megumi Home 路径解析与目录创建
│   └── server/
│       ├── app.py            # FastAPI 应用、lifespan、/health、错误映射
│       └── main.py           # 绑定端口、启动与停止 uvicorn
└── tests/                    # pytest 测试
```

## 给 Java 开发者的对照

| Java Web | 这里的位置 |
| --- | --- |
| Maven / Gradle | uv（`uv add` 加依赖、`uv run` 运行） |
| `pom.xml` | `pyproject.toml` |
| Spring Boot 启动类 | `app.py` 的 `MegumiApp` + `server/main.py` |
| 内嵌 Tomcat | uvicorn |
| `@RestController` | `server/app.py` 里的 `@app.get("/health")` |
| DTO + Bean Validation | Pydantic 模型（后续阶段加入） |
| `application.yml` | 环境变量（上表）+ 以后的 `settings.json` |
| JUnit | pytest |
| Checkstyle + 编译期类型检查 | ruff + mypy |

## 后续阶段会加什么（现在还没有）

RPC 操作路由与事件通道、模型调用层、Agent 执行引擎、数据存储（SQLite）、发现业务（兴趣／候选池／推荐／偏好学习）。这一步刻意不引入这些依赖。
