"""Build-time semantic workflow indexing & Skill conflict-group classification for Shiju Workflow Studio."""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

STAGES = [
    {"id": "plan", "zh": "筹备与拆解", "en": "Plan & Prep", "hintZh": "明确结构、素材或架构边界", "hintEn": "Scope, assets & architecture"},
    {"id": "core", "zh": "核心主力", "en": "Core Engine", "hintZh": "主流程执行与核心产出", "hintEn": "Primary execution engine"},
    {"id": "polish", "zh": "精修增强", "en": "Polish & Enhance", "hintZh": "字幕、动效、视觉或文风打磨", "hintEn": "Motion, captions, taste & polish"},
    {"id": "ship", "zh": "质检与交付", "en": "Verify & Ship", "hintZh": "自动质检、审查调试或发布", "hintEn": "QA, review, debug & publish"},
]

# Explicit mutual-exclusion groups so competing Skills/tools never conflict in the same workflow.
CONFLICT_GROUPS = {
    "cg:video-code-engine": {
        "zh": "代码视频渲染引擎互斥（Remotion / HyperFrames / 代码做片管线各自独立，单流程只启用 1 套）",
        "en": "Mutually exclusive programmatic video engine (keep one rendering pipeline per workflow)",
        "ids": {
            "skill-remotion-skills", "skill-remotion-3d", "skill-video-shotcraft", "skill-create-onboarding-video",
            "skill-hyperframes", "skill-hyperframes-cli", "skill-lemo-opuscar", "skill-claude-animated-shorts",
            "skill-cinetic",
        },
        "keywords": ["remotion", "hyperframes", "代码做片", "竖屏 3d 动画"],
    },
    "cg:video-cut-core": {
        "zh": "主力视频剪辑引擎互斥（FFmpeg-Skill / FredTalk / OpenMontage / VideoHighlighter 同属主剪辑入口，单流程选一最稳妥）",
        "en": "Mutually exclusive core video editing engine (pick one primary editor per workflow)",
        "ids": {
            "skill-ffmpeg-skill", "skill-fredtalk", "website-openmontage", "website-video-highlighter",
            "website-opencut", "website-hypit", "website-concat",
        },
        "keywords": ["视频剪辑", "口播视频", "自动剪辑", "视频高光"],
    },
    "cg:video-subtitle": {
        "zh": "音视频配音与字幕辅助互斥（避免多套字幕/配音管线重复转码）",
        "en": "Mutually exclusive subtitle/voiceover pipeline to avoid duplicate transcoding",
        "ids": {"skill-media-use", "website-videolingo", "website-voicestudio"},
        "keywords": ["双语字幕", "声音克隆", "多模态媒体"],
    },
    "cg:code-orchestrator": {
        "zh": "全局开发流程总控 Skill 互斥（同时挂载多套工作流规范会导致指令互相覆盖）",
        "en": "Mutually exclusive global engineering orchestrator (loading multiple overrides workflow rules)",
        "ids": {
            "skill-agent-skills", "skill-agency-agents", "skill-oil-dev-skills",
            "skill-setup-matt-pocock-skills", "skill-superpowers", "skill-everything-claude-code",
        },
        "keywords": ["全流程工程工作流", "多部门 ai 专家", "开发流程 skills", "工程实践 skills"],
    },
    "cg:ui-aesthetic": {
        "zh": "全局 UI 审美约束 Skill 互斥（避免两套视觉规则在排版与配色上打架）",
        "en": "Mutually exclusive UI taste/aesthetic rulebook (prevents conflicting layout & style directives)",
        "ids": {"skill-frontend-design", "skill-unslop", "skill-impeccable", "skill-ui-ux-pro-max"},
        "keywords": ["去ai味", "反模板感", "ui 审美", "de-slop"],
    },
    "cg:ppt-engine": {
        "zh": "PPT 主生成引擎互斥（不同幻灯片格式与版式模板体系，单次汇报选定一套）",
        "en": "Mutually exclusive slide/PPT generator engine (choose one output architecture)",
        "ids": {
            "skill-codex-ppt", "skill-html-ppt", "skill-nanobanana-ppt", "skill-ppt-master",
            "skill-frontend-slides",
        },
        "keywords": ["ai ppt", "html ppt", "幻灯片", "演示文稿", "原生pptx"],
    },
    "cg:code-review": {
        "zh": "代码审查主引擎互斥（避免重复触发多套 Review 规则消耗 Token）",
        "en": "Mutually exclusive code review engine (avoids duplicate review passes)",
        "ids": {"website-open-code-review", "skill-code-review"},
        "keywords": ["代码审查", "code review"],
    },
    "cg:context-opt": {
        "zh": "上下文压缩与输出精简策略互斥（同时开启易互相干扰输出格式与上下文裁剪）",
        "en": "Mutually exclusive context compression / token-saving strategy",
        "ids": {"skill-context-mode", "skill-caveman", "skill-billion-context", "skill-handoff"},
        "keywords": ["上下文压缩", "省token", "context pruning", "context compression"],
    },
    "cg:browser-auto": {
        "zh": "浏览器控制驱动互斥（同一会话保持一套浏览器控制协议更稳定）",
        "en": "Mutually exclusive browser automation driver (keep one active protocol per session)",
        "ids": {"skill-chrome-devtools-mcp", "skill-agent-browser", "website-obscura"},
        "keywords": ["chrome devtools", "无头浏览器", "headless browser", "playwright"],
    },
    "cg:de-ai-writing": {
        "zh": "文本去 AI 味改写规范互斥（避免多重改写导致表达失真）",
        "en": "Mutually exclusive de-AI writing style rewriter",
        "ids": {"skill-humanizer", "skill-humanizer-zh"},
        "keywords": ["去ai腔", "消除文本中 ai", "humanizer"],
    },
    "cg:social-card": {
        "zh": "社媒图文卡片模板互斥（单套内容流选用一种视觉卡片规范即可）",
        "en": "Mutually exclusive social card template system",
        "ids": {"skill-baoyu-xhs-images", "skill-guizang-social-card"},
        "keywords": ["小红书图文", "小红书组图", "社媒视觉卡片"],
    },
    "cg:diagram-tool": {
        "zh": "图解与交互图表引擎互斥（按需选用一种视觉图解风格）",
        "en": "Mutually exclusive diagram & visual explainer engine",
        "ids": {"skill-tinycharts", "skill-anima", "skill-seecode"},
        "keywords": ["手绘交互图表", "交互图解", "流程图"],
    },
    "cg:downloader": {
        "zh": "多线程下载器互斥（同类型桌面下载工具按需选一）",
        "en": "Mutually exclusive download manager",
        "ids": {"website-motrix", "website-misterdownloadmanager"},
        "keywords": ["多线程下载", "下载管理器", "idm替代"],
    },
    "cg:stock-monitor": {
        "zh": "补货与价格监控器互斥（避免重复轮询同一目标站点）",
        "en": "Mutually exclusive stock/restock monitor",
        "ids": {
            "website-changedetection-io", "website-monitor-stooock", "website-streetmerchant",
            "website-product-checker", "website-pokemon-stock-monitor", "website-costinel",
            "website-vpsmonitorbot", "website-vps-restock-monitoring", "website-spartanhost-monitor",
            "website-sku-spider", "website-jdautoshopping", "website-jd-shopper",
        },
        "keywords": ["补货监控", "库存监控", "vps监控", "sku监控"],
    },
}

DOMAINS = [
    ("video", "视频剪辑与动效", "Video & Editing", [
        "视频剪辑", "剪辑", "视频", "ffmpeg", "remotion", "hyperframes", "字幕", "口播", "配音", "宣传片", "短视频",
        "录屏", "镜头", "高光", "音视频", "视频复刻", "视频制作", "opencut", "videolingo", "fredtalk",
        "openmontage", "video", "editing", "caption", "subtitle", "audio", "voice", "motion", "shorts",
        "reanimate", "motion-design-skill", "cinetic", "tweakpane", "openverse", "librosa", "whisperx",
        "节拍", "缓动", "词级字幕", "动画工作室",
    ]),
    ("coding", "AI 编程与全栈工程", "AI Coding & Engineering", [
        "代码审查", "安全扫描", "开发", "编程", "代码", "架构", "重构", "审查", "测试", "安全", "漏洞", "调试", "mcp", "codex",
        "claude code", "cursor", "agent", "skill", "工作流", "上下文", "token", "批注", "浏览器", "tdd",
        "git", "pr", "issue", "rust", "cli", "coding", "review", "security", "debug", "workflow", "engineering",
    ]),
    ("frontend", "前端界面与交互动效", "Frontend & UI Motion", [
        "前端", "网页", "ui", "界面", "设计系统", "组件", "动效", "动画", "react", "tailwind", "shadcn",
        "3d", "webgl", "shader", "gsap", "framer", "卡片", "按钮", "导航", "下拉", "后台", "仪表盘",
        "微交互", "弹簧", "webgl", "three.js", "css", "web", "frontend", "animation", "layout", "interaction",
    ]),
    ("writing", "写作与深度科研", "Writing & Research", [
        "科研写作", "知识整理", "资料蒸馏", "写作", "论文", "科研", "学术", "小说", "文案", "去ai", "humanizer", "知识库", "笔记", "obsidian",
        "蒸馏", "调研", "阅读", "总结", "文档", "研究", "writing", "paper", "academic", "research", "blog",
    ]),
    ("ppt", "PPT 与视觉汇报", "Slides & Presentations", [
        "ppt", "pptx", "幻灯片", "演示", "汇报", "slides", "图表", "流程图", "信息图", "图解", "研报",
        "diagram", "chart", "presentation", "deck",
    ]),
    ("visual", "图像创作与平面视觉", "Image & Visual Design", [
        "画图", "生图", "图像", "海报", "封面", "logo", "拼贴", "撕纸", "摄影", "插画", "gif", "表情包",
        "视觉", "配色", "排版", "印刷", "半调", "涂鸦", "复古", "poster", "image", "collage", "photo", "art",
    ]),
    ("social", "社媒增长与跨境电商", "Social & E-Commerce", [
        "社媒", "小红书", "自媒体", "多平台发布", "seo", "geo", "电商", "跨境", "广告", "主图", "出海",
        "增长", "营销", "热点", "一人公司", "opc", "social", "marketing", "ecommerce", "xhs", "publish",
    ]),
    ("reverse", "逆向分析与产品复刻", "Reverse Engineering", [
        "逆向", "复刻", "拆解", "黑盒", "爬虫", "抓取", "scraping", "crawl", "rea", "clean-room", "reverse",
    ]),
    ("language", "语言学习与英语练习", "Language Learning", [
        "英语", "英文", "口语", "背单词", "单词", "听力", "精听", "雅思", "托福", "四六级",
        "english", "vocabulary", "speaking", "listening", "ielts", "toefl", "typewords", "kouyu",
    ]),
    ("productivity", "效率工具与本地办公", "Productivity & Local Apps", [
        "效率", "办公", "pdf", "表格", "文档", "下载", "清理", "远程", "互传", "记账", "理财", "求职",
        "简历", "面试", "监控", "补货", "自动化", "桌面", "离线", "本地", "finance",
        "office", "utility", "desktop", "download",
    ]),
]

PRESETS = [
    {
        "id": "preset-video",
        "zh": "视频剪辑与成片",
        "en": "Video Editing",
        "queryZh": "我想做视频剪辑，包含素材字幕配音、主力剪辑和成品发布",
        "queryEn": "Video editing pipeline with captions, cutting, motion, and publishing",
        "domain": "video",
    },
    {
        "id": "preset-animation",
        "zh": "AI 动画工作室",
        "en": "AI Animation Studio",
        "queryZh": "我想做专业工作室级 AI 动画，需要逐帧参考动画、优化节奏缓动、滑块调参、配乐节拍、词级字幕和 FFmpeg 导出",
        "queryEn": "AI animation studio workflow with frame-by-frame motion reference, easing, beat sync, word-level captions, and FFmpeg export",
        "domain": "video",
    },
    {
        "id": "preset-coding",
        "zh": "AI 全栈开发",
        "en": "AI Engineering",
        "queryZh": "我想做 AI 全栈项目开发，需要架构规范、编码调试、代码审查与安全扫描",
        "queryEn": "Full-stack AI engineering with architecture, debugging, code review, and security",
        "domain": "coding",
    },
    {
        "id": "preset-frontend",
        "zh": "高颜值前端产品",
        "en": "Frontend & Motion",
        "queryZh": "我想做一个高颜值交互前端网站，需要 UI 审美规范、动效组件与微交互提示词",
        "queryEn": "Polished interactive frontend with UI design standards, motion libraries, and micro-interactions",
        "domain": "frontend",
    },
    {
        "id": "preset-social",
        "zh": "社媒与电商内容",
        "en": "Social & E-Com",
        "queryZh": "我想做小红书社媒与电商内容，需要热点调研、视觉封面、文案去 AI 味和自动发布",
        "queryEn": "Social & e-commerce content with trend research, visual cards, humanizer, and auto-publish",
        "domain": "social",
    },
    {
        "id": "preset-ppt",
        "zh": "高定汇报 PPT",
        "en": "Slide Decks",
        "queryZh": "我想做高质量商务汇报 PPT，需要图表图解、动态演示生成与视觉美化",
        "queryEn": "Executive presentation deck with diagrams, slide generation, and visual polish",
        "domain": "ppt",
    },
    {
        "id": "preset-writing",
        "zh": "深度写作与科研",
        "en": "Writing & Research",
        "queryZh": "我想做深度科研写作与知识整理，需要资料蒸馏、论文辅助和文本去 AI 味",
        "queryEn": "Deep research and writing workflow with distillation, paper drafting, and de-AI polish",
        "domain": "writing",
    },
    {
        "id": "preset-reverse",
        "zh": "逆向拆解与复刻",
        "en": "Reverse & Clone",
        "queryZh": "我想做软件或视频的逆向分析、网页抓取与净室复刻开发",
        "queryEn": "Reverse engineering, web scraping, and clean-room reconstruction workflow",
        "domain": "reverse",
    },
    {"id": "preset-language", "zh": "英语学习与口语", "en": "English Learning",
     "queryZh": "学习英语，练习口语听力和背单词", "queryEn": "English speaking, listening and vocabulary practice", "domain": "language"},
]

PLAN_SIGNALS = [
    "调研", "选题", "热点", "方案", "架构", "规划", "澄清", "拆解", "逆向", "知识蒸馏", "录屏", "抓取",
    "爬虫", "素材", "灵感", "规范", "文档", "research", "plan", "architect", "spec", "discover", "probe",
    "inspiration", "reference", "scrape", "record", "onboarding", "grill", "triage",
]
POLISH_SIGNALS = [
    "字幕", "配音", "语音", "音效", "去ai", "humanizer", "审美", "反模板", "动效", "转场", "微交互",
    "配色", "排版", "压缩", "省token", "上下文", "封面", "图文", "卡片", "海报", "美化", "gif",
    "subtitle", "voice", "audio", "polish", "aesthetic", "motion", "transition", "token", "context", "style",
]
SHIP_SIGNALS = [
    "审查", "质检", "安全", "漏洞", "扫描", "测试", "调试", "批注", "收件箱", "发布", "上传", "分发",
    "监控", "补货", "seo", "devtools", "review", "security", "audit", "test", "debug", "publish",
    "upload", "deploy", "annotate", "inbox", "monitor", "verify",
]


def contains(text: str, term: str) -> bool:
    if term.isascii():
        return re.search(r"(?<![a-z0-9])" + re.escape(term) + r"(?![a-z0-9])", text) is not None
    return term in text


def item_kind(item: dict) -> str:
    k = item.get("kind")
    return k if k in ("skill", "website") else "prompt"


def assign_conflict_group(item: dict, blob: str) -> str | None:
    iid = item["id"]
    for cg_id, meta in CONFLICT_GROUPS.items():
        if iid in meta["ids"]:
            return cg_id
    for cg_id, meta in CONFLICT_GROUPS.items():
        if any(contains(blob, kw) for kw in meta["keywords"]):
            # Only apply keyword-based conflict grouping to skills & active tools, never passive prompts
            if item_kind(item) != "prompt":
                return cg_id
    return None


def assign_stage(item: dict, blob: str, cg: str | None) -> int:
    kind = item_kind(item)
    STAGE_OVERRIDES = {
        "skill-reanimate": 0,
        "website-openverse": 0,
        "website-librosa": 0,
        "skill-motion-design-skill": 2,
        "website-tweakpane": 2,
        "website-whisperx": 2,
        "skill-ffmpeg-skill": 3,
    }
    if item["id"] in STAGE_OVERRIDES:
        return STAGE_OVERRIDES[item["id"]]
    if item['id'] in {'website-typewords', 'website-ethanenglish', 'skill-kouyu'}:
        return 1  # Alternative learning engines, not artificial Plan/Polish/Ship stages.
    # Explicit conflict-group stage anchors
    if cg in ("cg:video-code-engine", "cg:video-cut-core", "cg:code-orchestrator", "cg:ppt-engine"):
        return 1
    if cg in ("cg:video-subtitle", "cg:ui-aesthetic", "cg:context-opt", "cg:de-ai-writing", "cg:social-card"):
        return 2
    if cg in ("cg:code-review", "cg:browser-auto", "cg:stock-monitor"):
        return 3

    p_score = sum(1 for k in PLAN_SIGNALS if contains(blob, k))
    pol_score = sum(1 for k in POLISH_SIGNALS if contains(blob, k))
    ship_score = sum(1 for k in SHIP_SIGNALS if contains(blob, k))

    if kind == "prompt":
        return 2 if pol_score >= p_score else 1

    if ship_score >= 2 and ship_score >= pol_score and ship_score >= p_score:
        return 3
    if p_score >= 2 and p_score > pol_score and p_score >= ship_score:
        return 0
    if pol_score >= 2 and pol_score > p_score:
        return 2
    if ship_score == 1 and p_score == 0 and pol_score == 0:
        return 3
    if p_score == 1 and pol_score == 0:
        return 0
    return 1


def score_domains(item: dict, title_tags: str, full_blob: str) -> dict[str, int]:
    out: dict[str, int] = {}
    topics = " ".join(item.get("skillTopics") or item.get("topics") or []).lower()
    for d_id, _, _, kws in DOMAINS:
        # Interface language and English text in a design example are not language-learning capabilities.
        if d_id == 'language' and not re.search(r'英语|口语|背单词|英文学习|english.{0,15}(learn|practic)|vocabulary|kouyu|typewords', title_tags):
            continue
        sc = 0
        for kw in kws:
            if contains(title_tags, kw):
                sc += 4
            elif contains(topics, kw):
                sc += 3
            elif contains(full_blob, kw):
                sc += 1
        if sc > 0:
            out[d_id] = min(30, sc)
    if not out:
        kind = item_kind(item)
        if kind == "prompt":
            out["frontend"] = 3
        elif kind == "website":
            out["productivity"] = 3
        else:
            out["coding"] = 3
    return out


def build(root: Path, items: list[dict]) -> str:
    indexed = []
    cg_counts = Counter()
    domain_counts = Counter()

    for it in items:
        en = it.get("en") or {}
        title_tags = " ".join([
            it.get("title", ""),
            it.get("tags", ""),
            en.get("title", ""),
            en.get("tags", ""),
        ]).lower()
        full_blob = " ".join([
            title_tags,
            it.get("description", ""),
            en.get("description", ""),
            " ".join(it.get("skillTopics") or it.get("topics") or []),
        ]).lower()

        cg = assign_conflict_group(it, full_blob)
        stage = assign_stage(it, full_blob, cg)
        doms = score_domains(it, title_tags, full_blob)
        if cg:
            cg_counts[cg] += 1
        for d in doms:
            domain_counts[d] += 1

        # Quality signal for ranking well-documented & rich items
        qual = 1.0
        if it.get("preview"):
            qual += 0.12
        if it.get("repository") or it.get("officialUrl"):
            qual += 0.1
        if item_kind(it) == "skill":
            qual += 0.15

        entry = {
            "id": it["id"],
            "k": item_kind(it)[0],  # 's' | 'w' | 'p'
            "st": stage,
            "d": doms,
            "q": round(qual, 2),
        }
        if cg:
            entry["cg"] = cg
        indexed.append(entry)

    payload = {
        "version": 2,
        "stages": STAGES,
        "domains": [{"id": d, "zh": zh, "en": en, "kws": kws} for d, zh, en, kws in DOMAINS],
        "conflictGroups": {k: {"zh": v["zh"], "en": v["en"]} for k, v in CONFLICT_GROUPS.items()},
        "presets": PRESETS,
        "items": indexed,
    }

    out_path = root / "assets" / "workflow-index.json"
    compact = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    out_path.write_text(compact, encoding="utf-8")
    return compact


if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    items = json.loads((root / "prompts.json").read_text(encoding="utf-8"))
    compact = build(root, items)
    data = json.loads(compact)
    cg_n = sum(1 for x in data["items"] if "cg" in x)
    print(
        f"Built workflow-index.json ({len(compact)/1024:.1f} KB): "
        f"{len(data['items'])} items, {len(data['domains'])} domains, "
        f"{len(data['conflictGroups'])} conflict groups ({cg_n} items tagged)"
    )
