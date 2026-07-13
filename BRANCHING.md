# 事实协议报告 — 分支管理策略

## 分支模型 (Git Flow 简化版)

```
main          ← 稳定发布分支，只接受合并，不直接提交
 └── develop  ← 日常开发主干，集成各功能分支
      ├── feature/xxx   ← 新功能开发
      ├── fix/xxx       ← Bug 修复
      ├── hotfix/xxx    ← 紧急修复（从 main 拉出，修复后合回 main 和 develop）
      └── refactor/xxx  ← 代码重构
```

## 分支命名规范

| 类型 | 前缀 | 示例 | 说明 |
|------|------|------|------|
| 主分支 | `main` | `main` | 生产环境稳定代码 |
| 开发分支 | `develop` | `develop` | 日常开发集成 |
| 新功能 | `feature/` | `feature/report-template` | 新功能开发 |
| Bug修复 | `fix/` | `fix/data-parsing-error` | 非紧急 Bug 修复 |
| 紧急修复 | `hotfix/` | `hotfix/critical-crash` | 线上紧急问题 |
| 重构 | `refactor/` | `refactor/auth-module` | 代码结构优化 |
| 文档 | `docs/` | `docs/api-reference` | 文档更新 |
| 测试 | `test/` | `test/unit-tests` | 测试相关 |

## 工作流程

### 1. 开始新功能 / 修复

```bash
# 从 develop 拉取最新代码
git checkout develop
git pull origin develop

# 创建功能分支
git checkout -b feature/your-feature-name
```

### 2. 开发过程中提交

```bash
git add -A
git commit -m "feat: 添加了 XXX 功能"
git push origin feature/your-feature-name
```

### 3. 完成后合并到 develop

```bash
git checkout develop
git pull origin develop
git merge --no-ff feature/your-feature-name
git push origin develop

# 删除已合并的本地分支
git branch -d feature/your-feature-name
# 删除远程分支
git push origin --delete feature/your-feature-name
```

### 4. 发布到 main（稳定版）

```bash
git checkout main
git pull origin main
git merge --no-ff develop
git push origin main
# 打标签
git tag -a v1.0.0 -m "发布说明"
git push origin v1.0.0
```

## Commit 提交信息规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <subject>

<body>
```

### Type 类型

| Type | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `style` | 代码格式（不影响功能） |
| `refactor` | 重构（非新增功能也非修复 Bug） |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `chore` | 构建/工具变更 |
| `ci` | CI 配置变更 |

### 示例

```
feat(report): 添加事实协议报告生成功能
fix(parser): 修复日期解析时区错误
docs(readme): 更新使用说明
refactor(auth): 重构认证模块，提取公共方法
```

## 快捷命令 (Git Aliases)

本项目已配置以下 git 快捷命令：

```bash
git co <branch>          # = git checkout
git br <branch>          # = git branch
git ci "msg"             # = git commit -m
git st                   # = git status -sb
git lg                   # = 精美日志
git feature <name>       # 从 develop 创建功能分支
git fixbranch <name>     # 从 develop 创建修复分支
git hotfix <name>        # 从 main 创建紧急修复分支
git done                 # 合并当前分支到 develop 并删除
git release <version>    # 合并 develop 到 main 并打标签
```
