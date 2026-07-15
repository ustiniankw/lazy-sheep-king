# 推送到 GitHub（ustiniankw/lazy-sheep-king）

沙箱里没有你的 GitHub 凭证，所以本地已经 `git init + git commit` 完毕，但没法帮你 push。
下面挑一种你顺手的方式，把仓库推到 <https://github.com/ustiniankw/lazy-sheep-king>：

---

## 方式 A：先在 GitHub 建仓库，再推（最推荐）

1. 打开 <https://github.com/new>
2. Owner 选 `ustiniankw`，Repository name 填 `lazy-sheep-king`
3. **不要勾** "Add a README / .gitignore / license"（我们本地已经有了）
4. 建好后回到本地目录：

```bash
cd path/to/lazy-sheep-king
# 已经 git init + commit 过，直接：
git branch -M main
git remote set-url origin https://github.com/ustiniankw/lazy-sheep-king.git   # 已经加过就跳过
git push -u origin main
```

推的时候 GitHub 会让你输入用户名 + Personal Access Token（PAT）：
- 用户名：`ustiniankw`
- 密码：粘贴你的 [PAT](https://github.com/settings/tokens?type=beta)（勾选 `Contents: Read & Write` 权限即可）

---

## 方式 B：SSH 直接推

前提：本机 `~/.ssh/id_ed25519.pub` 已经加进 GitHub → Settings → SSH keys。

```bash
cd path/to/lazy-sheep-king
git remote set-url origin git@github.com:ustiniankw/lazy-sheep-king.git
git push -u origin main
```

---

## 方式 C：GitHub CLI 一条命令

```bash
brew install gh   # macOS
gh auth login     # 一次性登录
cd path/to/lazy-sheep-king
gh repo create ustiniankw/lazy-sheep-king --source=. --public --push
```

---

## 方式 D：把 zip 拖到 GitHub 网页上传

如果暂时不想装/配 git 工具：
1. 用 `lazy-sheep-king.zip`（同目录已经打包好，1.2 MB）解压
2. 在 GitHub 新建空仓库 `ustiniankw/lazy-sheep-king`
3. 页面上点 `uploading an existing file`，把 `lazy-sheep-king/` 里的文件拖上去
4. 底部填 commit message 后 Commit changes

---

## 推完之后 · 建议做的事

- 到仓库 Settings → Pages → 选 `main` / `docs` 也可以，把 `docs/preview.html` 或本仓库 `preview_site/` 部署成 GitHub Pages，就有个免费的在线预览地址了。
- 加 Topics：`chrome-extension`、`productivity`、`procrastination`、`lazy-sheep`、`task-breakdown`。
- Description 建议：`让懒虫也能一步一步搞定事情 🐑👑 · 输入任务 → 傻瓜级步骤 → 一步一步跟着做，撒彩带鼓励你！`
