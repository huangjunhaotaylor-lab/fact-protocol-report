# 事实协议报告 (Fact Protocol Report)

本仓库用于存放事实协议报告相关代码与文档。

## 仓库信息

- **仓库地址**：https://github.com/huangjunhaotaylor-lab/fact-protocol-report
- **维护者**：HUANGJUNHAOTAYLOR-LAB

## 分支管理

本项目采用 Git Flow 简化版分支策略，详见 [BRANCHING.md](./BRANCHING.md)。

```
main          ← 稳定发布分支
 └── develop  ← 日常开发主干
      ├── feature/*   ← 新功能
      ├── fix/*       ← Bug 修复
      └── hotfix/*    ← 紧急修复
```

### 快速开始

```bash
# 克隆仓库
git clone https://github.com/huangjunhaotaylor-lab/fact-protocol-report.git
cd fact-protocol-report

# 切换到开发分支
git checkout develop

# 创建新功能分支
git checkout -b feature/your-feature
```

## 开发流程

1. 从 `develop` 拉取最新代码
2. 创建功能分支 `feature/xxx`
3. 开发并提交代码
4. 合并回 `develop`
5. 稳定后合并 `develop` → `main` 并打标签发布
