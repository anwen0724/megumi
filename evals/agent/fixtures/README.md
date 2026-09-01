# Evaluation Fixtures

`fixtures/` 保存 Case 执行前需要安装到隔离环境的场景数据。Fixture 是“题目的已知条件”，不是评分答案。

Fixture 可以提供：

- Workspace、会话和消息；
- Interest、Candidate、Recommendation 与反馈事实；
- 用户设置和固定时钟；
- Controlled Profile 下预先定义的搜索、抓取和来源返回；
- Case 执行时需要引用的稳定业务 ID。

安装后，真实 Product Runtime 仍通过自己的 Repository、Context Resolver、Prompt 和 Tool 读取这些信息。Fixture 内容只有在正常产品链路本来就会读取它时，才会进入候选模型输入。

每个 Fixture 独立安装到该 Case 的 Home、数据库和 Workspace。Case 的 `capability`、`setup.fixtureId`、`fixtureVersion` 必须分别匹配 Fixture 的 `capability`、`fixtureId`、`version`，Catalog 校验失败时不会开始评估。

Controlled Fixture 固定外部输入以获得可复现的比较，但不会伪造候选模型输出。Live Profile 则使用真实外部依赖。
