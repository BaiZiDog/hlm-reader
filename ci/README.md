# CI 工作流模板

这里的 `pages.yml` 与 `android.yml` 需要复制到 `.github/workflows/` 才会生效。
当前仓库的初始推送使用了不带 `workflow` scope 的 GitHub OAuth token，因此工作流
暂未放入 `.github/workflows/`；这不影响源码、PWA 或 APK 的本地构建。

启用方法（任选其一）：

1. 在 GitHub 网页上创建 `.github/workflows/` 并粘贴这两个文件；
2. 给 `gh` 增加 workflow scope 后推送：

   ```bash
   gh auth refresh -s workflow
   mkdir -p .github/workflows
   cp ci/pages.yml ci/android.yml .github/workflows/
   git add .github/workflows
   git commit -m "ci: enable Pages and Android builds"
   git push
   ```

- `pages.yml`：把 `reader/app` 部署到 GitHub Pages（不含书页数据，首次打开是导入页）。
- `android.yml`：手动触发或推送 `v*` 标签时构建 debug APK，产出 artifact。
