# 拾句 · 个人提示词工具箱

**[直接打开网页](https://ryanwang688.github.io/shiju-prompt-toolbox/)**

GitHub Pages 从 main 分支根目录自动发布。

新增“实用网站”栏目：目前收录 OpenCut，附实际官网截图、用途介绍和访问入口，同样支持收藏、个人评分与备份。网站截图按记录日期展示，不是实时抓取。

采用 Dashboard 布局：左侧为固定纯图标导航轨，按内容类型、收藏和主题分类用分隔线分组；悬停或键盘聚焦显示名称与数量提示，Escape 可关闭。保留浅紫、奶白与黄色配色，小屏内容自动改为单列。

已收录 4 条动效提示词和 7 个 Skills / 设计资源：RuiC-card-skill、gsap-skills、child-photo-doodle-collage、pixel2motion、Impeccable、Awesome DESIGN.md、MOSS-Image。

新增 Impeccable（前端设计与界面打磨），配作者 Neo Mirai 真实案例截图；Awesome DESIGN.md 为设计规范参考库，配作者 getdesign.md 的 Apple 风格 / Lumora 实际交互预览截图，按用户要求归入 Skills。两者均注明来源，非本次生成。

MOSS-Image 收录官方图像模型项目及其 moss-image-prompt-enhancer Skill，配官方模型输出合集。Skill 负责提示词增强与布局规划，本身不直接生成图片，卡片详情已区分说明。

Skills 使用真实效果预览：涂鸦照片与 RuiC 卡牌采用原作者公开的作品/演示，GSAP 使用本次实际运行动画后保存的截图，并附可播放演示。详情标明来源和生成方式；素材归属与许可说明见各自 assets 目录的 ATTRIBUTION.md。

支持搜索、分类、收藏、原文复制、手动新增与编辑、JSON 备份和恢复；预览可使用图片、视频或独立 HTML 动效。

也可收录 Skills：保存名称、来源和一句话用途介绍。提示词和 Skills 均支持用户自评 1～5 星、按评分排序；重复点击当前星级可清除评分。评分保存在当前浏览器，刷新后保留，并随 JSON 备份导出、导入恢复；目前不跨设备自动同步。

以后告知代理“把某个 Skill 加入工具箱”时，代理会先核实用途，收录后简短介绍该 Skill 是做什么的。收录不等于安装或执行。

## 使用

直接在浏览器打开 `index.html`，或在本目录运行：

```sh
python -m http.server 8766
```

然后访问 `http://localhost:8766`。

仓库收录内容来自 `prompts.json`。页面里手动添加的内容保存在当前浏览器，需要导出备份才能转移；浏览器本地内容不会自动推送到 GitHub。

## 后续收录

把想收藏的提示词发给维护此项目的代理，即按 `AGENTS.md` 执行：保留原文 → 整理分类与标签 → 制作合适的图片或动效预览 → 更新数据并检查 → 提交到本仓库。

这个流程由收到请求的代理执行，不是后台监听所有聊天的自动化。

编辑数据或页面模板后运行：

```sh
python build.py
```

`build.py` 校验数据和预览文件路径，再把数据嵌入 `index.html`，因此页面可离线打开，无需安装依赖。页面预览是针对提示词制作的示意或演示；只有实际生成并保存的模型输出才标为生成结果。
