# Tests

Tests mirror the source tree:

- `tests/apps/` covers runnable applications.
- `tests/packages/` covers reusable packages.
- `tests/support/` is reserved for shared fixtures, mocks, and render helpers.

## 测试保留策略

测试是否需要长期保留，取决于它是否仍然保护当前产品行为、工程边界或公共契约，而不是取决于它是不是某个开发阶段临时新增的。

长期保留的测试包括：

- 用户可见行为和关键交互的回归测试，例如 chat timeline、composer、workspace panel、settings 和 renderer stores。
- shared contracts、runtime schemas、IPC channels、preload API、repository、core runtime helper 和 package boundary 测试。
- 防止安全、隐私或架构边界回退的 source guard / architecture guard，例如 renderer 不直接访问 Host 能力、secret/raw prompt/raw provider body 不泄露。

阶段性 guard / cleanup 测试可以在对应阶段稳定后重新评估。只有当被保护的旧路径、旧组件、旧命名或迁移风险已经明确废弃，并且已有更贴近当前模块的测试覆盖相同行为时，才应该删除或合并这些测试。不要因为测试最初来自某个 implementation plan 就默认删除。

## 运行策略

日常代码改动应优先运行与改动范围匹配的 focused tests，并配合 `npx tsc --noEmit`。准备合并、阶段收尾、跨模块重构或涉及 shared contract / IPC / runtime / persistence 的改动时，应运行完整测试：

```bash
npm test
```

纯文档变更通常不需要运行测试，但应检查 diff 和格式；如果文档变更会影响后续 plan 执行规则，应明确说明未运行代码测试的原因。

Testing guidance for public contributors lives in `../docs/development.md`.

Detailed local planning and architecture notes may exist in `.local-docs/` during active local development; that directory is intentionally not part of the public repository.
