# Built-in Skills

此目录用于存放 Megumi 随产品发布的内置 Skill。

每个内置 Skill 拥有独立子目录，并以 `SKILL.md` 作为入口文件。当前提供以下任务型学习 Skill：

- `explain-school-problem`：讲解题目或知识点；
- `review-student-answer`：检查和批改学生作答；
- `generate-study-practice`：按要求生成练习；
- `review-study-materials`：综合资料形成复习结果；
- `plan-study-session`：安排一次可执行的学习过程。

这些 Skill 复用现有 Agent Runtime、Skill Catalog、Tools 和 Permissions，不定义新的 Agent 类型或运行链路。
