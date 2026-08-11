# 介绍站（占位，待建）

当前 `site/` 仅有占位文件（index.html + icon）。GitHub Pages 部署已**停用**（pages.yml `if: false`）——仓库 Pages 未启用导致部署 3 连败。

## 待办

- [ ] 填充介绍页内容：主链流程、功能预览截图、下载入口（指向 Releases）
- [ ] 启用步骤：1) 仓库 Settings → Pages → Source: GitHub Actions（手动启用一次）
  - 2) `.github/workflows/pages.yml` 移除 `if: false`
  - 3) 推送 site/** 触发部署
- [ ] 参考：参考项目公开站（ExplosiveCoderflome/AI-Novel-Writing-Assistant 的 GitHub Pages 介绍站）

## 现状说明

- 不建站期间，`site/**` 变更不再触发部署（防红叉）
- 手动 workflow_dispatch 同样被 `if: false` 拦截
