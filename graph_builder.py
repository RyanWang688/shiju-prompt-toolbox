"""Build-time semantic relationship extraction and multi-level force layout for the Knowledge Graph."""
from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlparse

TOPIC_NAMES = {
    "skill": ["图像创作", "视觉设计", "动画视频", "写作创作", "开发工具", "求职效率", "其他"],
    "prompt": ["卡片交互", "按钮交互", "下拉菜单", "App 交互", "后台布局", "导航设计", "网页特效", "图像创作", "其他"],
    "website": ["动效灵感", "组件动画库", "设计素材", "创作工具", "实用软件", "其他"],
}
CATEGORY_TO_SKILL_TOPIC = {
    "动画动效": "动画视频",
    "界面设计": "视觉设计",
    "写作表达": "写作创作",
}

# Canonical bilingual concept buckets -> (concept_key, weight, zh_label, en_label, aliases)
CONCEPT_DEFS = [
    ("c:ppt", 3.2, "AI 演示 / PPT", "AI Slides & PPT", [
        "ai ppt", "ppt", "pptx", "slides", "frontend slides", "幻灯片", "演示文稿", "原生pptx", "svg转ppt", "商务汇报", "研报演示",
    ]),
    ("c:3d", 3.1, "3D / WebGL / 着色器", "3D, WebGL & Shaders", [
        "three.js", "threejs", "webgl", "3d", "shader", "shaders", "glsl", "着色器", "网页特效", "粒子特效", "canvas",
    ]),
    ("c:video", 3.0, "视频创作与剪辑", "Video & Motion", [
        "remotion", "video", "视频剪辑", "视频复刻", "动画视频", "短视频", "口播视频", "ai剪辑", "视频高光", "镜头拆解", "动画短片", "竖屏动画", "ffmpeg", "after effects", "hyperframes",
    ]),
    ("c:audio-media", 3.0, "音视频与多模态素材", "Audio & Multimodal Media", [
        "多模态媒体", "配音", "音效", "字幕", "抠图", "口语", "tts", "语音", "音频", "播客", "音视频",
    ]),
    ("c:coding-agent", 2.9, "AI 编程助手", "AI Coding Agents", [
        "claude code", "codex", "cursor", "windsurf", "coding agent", "ai编程", "编程agent", "终端agent", "opencode", "anthropic",
    ]),
    ("c:arch-plan", 3.0, "架构与方案设计", "Architecture & Planning", [
        "方案拷问", "软件架构", "代码重构", "技术债", "adr", "领域建模", "agents.md", "需求澄清", "issue 分诊", "pr 管理",
        "工程技能", "开发工作流", "matt pocock", "脚手架", "仓库初始化", "代码理解", "prd",
    ]),
    ("c:mcp", 2.9, "MCP 协议", "MCP Protocol", [
        "mcp", "model context protocol",
    ]),
    ("c:multi-agent", 3.0, "多智能体协作", "Multi-Agent Systems", [
        "多智能体", "多智能体编排", "多智能体协作", "多agent协同", "multi-agent", "multi agent", "agent team", "ai团队", "数字员工", "ai专家团队", "多部门角色",
    ]),
    ("c:llm-infra", 3.1, "模型网关与推理协议", "LLM Infra & Protocols", [
        "llm推理", "推理引擎", "模型网关", "llm router", "ag-ui", "agent协议", "生成式ui", "harness", "deepseek harness",
        "本地部署", "ollama", "gguf", "vllm", "预算管控", "opentelemetry", "agent 交易",
    ]),
    ("c:monitor", 3.3, "网页与补货监控", "Web & Stock Monitors", [
        "补货监控", "库存监控", "网页监控", "vps监控", "sku监控", "京东监控", "价格监控", "restock", "stock monitor", "web monitor", "vps monitor", "sku monitor",
    ]),
    ("c:ecom", 3.1, "电商视觉与运营", "E-Commerce & Ads", [
        "电商做图", "跨境电商", "e-commerce", "shopee", "mercado livre", "producthero", "/ugc model", "/meta ads", "/explodedview", "/3dbillboard", "/producthero", "独立站", "stripe",
    ]),
    ("c:english", 3.3, "英语与学习工具", "Language & Learning", [
        "英语学习", "背单词", "打字记忆", "四六级雅思", "english learning", "vocabulary", "ielts", "toefl", "教材", "口语练习",
    ]),
    ("c:reverse", 3.1, "逆向分析与复刻", "Reverse Engineering", [
        "逆向工程", "逆向分析", "净室复刻", "clean-room", "reverse engineering", "video recreation", "rea",
    ]),
    ("c:scraping", 3.1, "网页抓取与数据采集", "Web Scraping & Data", [
        "网页抓取", "爬虫", "scraping", "crawl", "firecrawl", "scrapling", "数据采集", "网页解析",
    ]),
    ("c:react-ui", 2.8, "React / 组件库", "React & UI Kits", [
        "react", "tailwind", "shadcn", "组件库", "组件动画库", "ui框架", "ui framework", "framer motion", "motion", "next.js", "nextjs", "typescript",
    ]),
    ("c:ui-design", 2.8, "UI 审美与设计系统", "UI & Design Systems", [
        "ui设计", "ui design", "设计系统", "design system", "去ai味", "de-slop", "前端设计", "反模板感",
        "配色", "渐变", "排版", "审美", "品牌", "字体", "色卡", "导航设计", "下拉菜单",
    ]),
    ("c:image-gen", 2.9, "图像生成与视觉创作", "Image Generation & Art", [
        "图像生成", "生图提示词", "小红书图文", "gif", "表情包", "海报", "logo", "摄影", "矢量", "封面",
        "动态视觉", "动态海报", "拼贴", "涂鸦", "绘本",
    ]),
    ("c:diagram", 3.0, "图表与交互图解", "Diagrams & Visuals", [
        "手绘", "流程图", "状态机", "时间线", "交互图解", "图表", "思维导图", "mermaid", "excalidraw", "信息图", "数据可视化", "生物学",
    ]),
    ("c:context", 3.1, "上下文与 Token 优化", "Context & Token Opt", [
        "上下文压缩", "context pruning", "context compression", "省token", "token-saving", "上下文管理",
    ]),
    ("c:writing", 2.9, "写作与科研辅助", "Writing & Research", [
        "小说创作", "学术论文", "科研写作", "科研副导师", "学术研究", "写作创作", "去ai腔", "paper writing", "vibe research", "academic research", "宝玉",
    ]),
    ("c:downloader", 3.3, "多线程下载工具", "Download Managers", [
        "下载器", "下载工具", "多线程下载", "bt磁力", "idm替代", "download manager", "bittorrent", "magnet",
    ]),
    ("c:sys-util", 2.9, "系统效率与桌面工具", "System & Desktop Utils", [
        "文件传输", "局域网互传", "远程控制", "pdf工具", "系统清理", "磁盘分析", "彻底卸载", "ocr识别", "桌面工具",
        "简历", "面试", "求职", "光猫工具", "airdrop替代", "cleanmymac替代",
    ]),
    ("c:gui-auto", 3.0, "跨端与 GUI 自动化", "GUI & Device Automation", [
        "桌面自动化", "手机自动化", "mac自动化", "浏览器自动化", "键鼠共享", "跨屏协同", "gui agent", "headless browser", "playwright", "puppeteer",
    ]),
    ("c:kg", 3.2, "知识图谱与语义层", "Knowledge Graph", [
        "知识图谱", "本体建模", "语义层", "knowledge graph", "ontology", "semantic layer", "obsidian",
    ]),
    ("c:social", 3.0, "社媒与内容增长", "Social & Growth Ops", [
        "社媒运营", "自媒体运营", "多平台发布", "小红书", "seo", "geo", "reddit", "opc", "一人公司",
    ]),
    ("c:rust", 2.9, "Rust 原生工具", "Rust Ecosystem", [
        "rust", "wgpu", "tauri", "egui",
    ]),
    ("c:dashboard", 2.9, "仪表盘与后台布局", "Dashboards & Layouts", [
        "dashboard", "后台布局", "后台导航", "dashboard layouts",
    ]),
    ("c:interaction", 2.9, "微交互与动效体验", "Micro-Interactions", [
        "app 交互", "按钮交互", "卡片交互", "下拉菜单", "弹簧物理", "手势交互", "物理动效", "微交互", "spring", "lottie", "gsap",
        "flip", "容器变形", "状态反馈", "弹性", "加载", "微动效", "列表网格",
    ]),
    ("c:devtools", 2.8, "代码审查与测试治理", "Review, QA & Governance", [
        "代码审查", "code review", "tdd", "测试驱动", "安全审计", "security audit", "bug定位", "仓库治理", "repo governance",
        "skills.sh", "npx skills", "技能发现", "分诊", "插件", "工具扩展", "无障碍",
    ]),
]

ALIAS_TO_CONCEPT: dict[str, str] = {}
CONCEPT_META: dict[str, tuple[float, str, str]] = {}
for cid, w, zh, en, aliases in CONCEPT_DEFS:
    CONCEPT_META[cid] = (w, zh, en)
    for al in aliases:
        ALIAS_TO_CONCEPT[al.lower()] = cid

STOP_TAGS = {
    "开源", "开源软件", "开源免费", "免费", "免费网站", "免费教育资源", "mit", "apache-2.0", "gpl-3.0", "agpl-3.0",
    "cc-by-4.0", "open source", "open-source", "opensource", "free", "partial", "paid", "agent skill", "skill", "skills",
    "agent", "ai", "ai agent", "github", "github 项目清单", "其他", "other", "tools", "tool", "工具", "实用软件", "创作工具",
    "cross-platform", "跨平台", "自托管", "self-hosted", "windows", "macos", "linux", "cli",
}

ASCII_STOPWORDS = {
    "the", "and", "for", "with", "that", "from", "this", "your", "into", "using", "open", "source", "tool", "tools",
    "app", "apps", "based", "support", "supports", "free", "code", "file", "files", "data", "web", "use", "used",
    "build", "make", "more", "fast", "simple", "modern", "native", "local", "style", "page", "pages", "site",
    "sites", "project", "github", "skill", "skills", "agent", "agents", "prompt", "prompts", "html", "css", "json",
    "api", "one", "all", "new", "high", "auto", "multi", "custom", "real", "full", "text", "view", "mode", "card",
    "cards", "help", "work", "workflow", "workflows", "guide", "official", "readme", "example", "demo", "line",
    "system", "like", "you", "can", "via", "without", "over", "any", "when", "how", "are", "not", "only",
    "also", "well", "better", "best", "easy", "clean", "light", "dark", "version", "run", "running", "create",
}


def item_kind(item: dict) -> str:
    k = item.get("kind")
    return k if k in ("skill", "website") else "prompt"


def item_topics(item: dict) -> list[str]:
    kind = item_kind(item)
    names = TOPIC_NAMES["skill" if kind == "skill" else "prompt" if kind == "prompt" else "website"]
    raw = item.get("skillTopics") if kind == "skill" else item.get("topics")
    if isinstance(raw, list):
        valid = []
        for t in raw:
            if t in names and t not in valid:
                valid.append(t)
        if valid:
            return valid
    if kind == "skill":
        return [CATEGORY_TO_SKILL_TOPIC.get(item.get("category", ""), "其他")]
    return ["其他"]


def github_owner(item: dict) -> str | None:
    for field in ("repository", "officialUrl", "source"):
        val = item.get(field) or ""
        if "github.com/" in val.lower():
            try:
                parts = [p for p in urlparse(val).path.split("/") if p]
                if len(parts) >= 2:
                    owner = parts[0].lower()
                    if owner not in ("topics", "explore", "search", "trending", "orgs", "users"):
                        return owner
            except Exception:
                pass
    return None


def split_tags(raw: str) -> list[str]:
    if not raw:
        return []
    return [t.strip() for t in re.split(r"[/,，、|]+", raw) if t.strip()]


def build_features(items: list[dict]):
    raw_tag_labels: dict[str, tuple[str, str]] = {}
    owners = [github_owner(it) for it in items]
    owner_counts = Counter(o for o in owners if o)

    item_feats: list[dict[str, float]] = []
    feat_labels: dict[str, tuple[str, str]] = {}

    for cid, (_, zh, en) in CONCEPT_META.items():
        feat_labels[cid] = (zh, en)

    for idx, item in enumerate(items):
        feats: dict[str, float] = {}
        zh_tags = split_tags(item.get("tags", ""))
        en_tags = split_tags((item.get("en") or {}).get("tags", ""))

        # 1. Tags -> concept buckets + specific normalized tags
        for i, t in enumerate(zh_tags + en_tags):
            tl = t.lower()
            if tl in STOP_TAGS or len(tl) < 2:
                continue
            cid = ALIAS_TO_CONCEPT.get(tl)
            if cid:
                w = CONCEPT_META[cid][0]
                feats[cid] = max(feats.get(cid, 0.0), w)
            else:
                matched = False
                for alias, bucket in ALIAS_TO_CONCEPT.items():
                    if len(alias) >= 4 and alias in tl:
                        w = CONCEPT_META[bucket][0] * 0.85
                        feats[bucket] = max(feats.get(bucket, 0.0), w)
                        matched = True
                if not matched or len(tl) >= 3:
                    tkey = f"tag:{tl}"
                    feats[tkey] = max(feats.get(tkey, 0.0), 2.4)
                    if tkey not in raw_tag_labels:
                        en_lbl = en_tags[i] if i < len(zh_tags) and i < len(en_tags) else t
                        raw_tag_labels[tkey] = (t, en_lbl)

        # 2. Same author/org owner (when appearing >= 2 times)
        owner = owners[idx]
        if owner and owner_counts[owner] >= 2:
            okey = f"owner:{owner}"
            feats[okey] = 2.6
            feat_labels[okey] = (f"同作者 · {owner}", f"Same author · {owner}")

        # 3. Topic feature (modest weight, anchors domain cluster)
        kind = item_kind(item)
        topics = item_topics(item)
        if topics:
            primary = topics[0]
            if primary != "其他":
                tkey = f"topic:{kind}:{primary}"
                feats[tkey] = 1.35
                feat_labels[tkey] = (f"同主题 · {primary}", f"Topic · {primary}")

        # 4. Concept hints + informative ASCII tokens from title/description
        blob = " ".join([
            item.get("title", ""),
            item.get("description", ""),
            (item.get("en") or {}).get("title", ""),
            (item.get("en") or {}).get("description", ""),
        ]).lower()
        for alias, bucket in ALIAS_TO_CONCEPT.items():
            if len(alias) >= 4 and alias in blob:
                w = CONCEPT_META[bucket][0] * 0.55
                feats[bucket] = max(feats.get(bucket, 0.0), w)

        for tok in re.findall(r"[a-z][a-z0-9_-]{2,20}", blob):
            if tok in ASCII_STOPWORDS or tok in STOP_TAGS:
                continue
            if tok in ALIAS_TO_CONCEPT:
                bucket = ALIAS_TO_CONCEPT[tok]
                feats[bucket] = max(feats.get(bucket, 0.0), CONCEPT_META[bucket][0] * 0.7)
            else:
                kkey = f"kw:{tok}"
                feats[kkey] = max(feats.get(kkey, 0.0), 1.1)
                feat_labels.setdefault(kkey, (tok, tok))

        item_feats.append(feats)

    df = Counter()
    for fdict in item_feats:
        for f in fdict:
            df[f] += 1

    N = len(items)
    for tkey, lbl in raw_tag_labels.items():
        feat_labels.setdefault(tkey, lbl)

    # Drop hyper-common (>35% of corpus) or singleton features from TF-IDF vectors
    max_df = max(12, int(N * 0.35))
    idf = {
        f: math.log((N + 1) / (cnt + 1)) + 1.0
        for f, cnt in df.items()
        if 2 <= cnt <= max_df
    }

    tfidf_vecs: list[dict[str, float]] = []
    primary_concepts: list[str | None] = []
    for fdict in item_feats:
        vec = {f: w * idf[f] for f, w in fdict.items() if f in idf}
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
        norm_vec = {f: v / norm for f, v in vec.items()}
        tfidf_vecs.append(norm_vec)

        concept_scores = [(v, f) for f, v in norm_vec.items() if f.startswith("c:")]
        if concept_scores:
            concept_scores.sort(key=lambda x: (-x[0], x[1]))
            primary_concepts.append(concept_scores[0][1])
        else:
            primary_concepts.append(None)

    return tfidf_vecs, feat_labels, idf, owners, primary_concepts


def compute_semantic_edges(
    items: list[dict],
    tfidf_vecs: list[dict[str, float]],
    feat_labels: dict[str, tuple[str, str]],
    idf: dict[str, float],
    owners: list[str | None],
):
    N = len(items)
    inv: dict[str, list[int]] = defaultdict(list)
    for idx, vec in enumerate(tfidf_vecs):
        for f in vec:
            inv[f].append(idx)

    candidates_per_node: list[list[tuple[float, int, str, str]]] = [[] for _ in range(N)]

    for i in range(N):
        vec_i = tfidf_vecs[i]
        if not vec_i:
            continue
        scores: dict[int, float] = defaultdict(float)
        best_feat: dict[int, tuple[float, str]] = {}
        for f, vi in vec_i.items():
            is_topic_only = f.startswith("topic:")
            for j in inv[f]:
                if j <= i:
                    continue
                contrib = vi * tfidf_vecs[j][f]
                if not is_topic_only:
                    scores[j] += contrib
                    prev = best_feat.get(j)
                    reason_prio = contrib * (1.8 if f.startswith(("c:", "owner:", "tag:")) else 0.7)
                    if not prev or reason_prio > prev[0]:
                        best_feat[j] = (reason_prio, f)
                else:
                    scores[j] += contrib * 0.45

        kind_i = item_kind(items[i])
        top_i = item_topics(items[i])[0]
        for j, sim in scores.items():
            if j not in best_feat:
                continue
            if owners[i] and owners[i] == owners[j]:
                sim += 0.28
                best_feat[j] = (99.0, f"owner:{owners[i]}")
            if item_kind(items[j]) == kind_i and item_topics(items[j])[0] == top_i:
                sim += 0.04
            sim = min(0.99, sim)
            if sim < 0.22:
                continue
            bf = best_feat[j][1]
            rz, re_ = feat_labels.get(bf, ("相关特性", "Related"))
            candidates_per_node[i].append((sim, j, rz, re_))
            candidates_per_node[j].append((sim, i, rz, re_))

    top_k_sets: list[set[int]] = []
    for i in range(N):
        candidates_per_node[i].sort(key=lambda x: -x[0])
        top_k_sets.append({j for _, j, _, _ in candidates_per_node[i][:3]})

    chosen: dict[tuple[int, int], tuple[float, str, str]] = {}
    deg = [0] * N

    all_pairs = []
    for i in range(N):
        for sim, j, rz, re_ in candidates_per_node[i][:5]:
            if i < j:
                mutual = (j in top_k_sets[i]) and (i in top_k_sets[j])
                all_pairs.append((mutual, sim, i, j, rz, re_))
    all_pairs.sort(key=lambda x: (-int(x[0]), -x[1]))

    for mutual, sim, i, j, rz, re_ in all_pairs:
        if (i, j) in chosen:
            continue
        cap = 7 if mutual else 5
        if deg[i] < cap and deg[j] < cap:
            chosen[(i, j)] = (sim, rz, re_)
            deg[i] += 1
            deg[j] += 1

    # Guarantee every node with candidates gets up to 2 clean neighbors
    for i in range(N):
        if deg[i] >= 2:
            continue
        for sim, j, rz, re_ in candidates_per_node[i][:4]:
            a, b = (i, j) if i < j else (j, i)
            if (a, b) in chosen:
                continue
            if deg[j] < 7:
                chosen[(a, b)] = (sim, rz, re_)
                deg[i] += 1
                deg[j] += 1
                if deg[i] >= 2:
                    break

    return [
        (i, j, round(sim, 2), rz, re_)
        for (i, j), (sim, rz, re_) in chosen.items()
    ]


def compute_node_importance(
    items: list[dict],
    sem_edges: list[tuple[int, int, float, str, str]],
) -> tuple[list[int], list[float]]:
    """Compute normalized landmark importance (0..1) combining degree, edge weight, and cross-hub bridges."""
    N = len(items)
    sem_deg = [0] * N
    weight_sum = [0.0] * N
    bridge_hubs: list[set[tuple[str, str]]] = [set() for _ in range(N)]

    primary_hub = [(item_kind(it), item_topics(it)[0]) for it in items]
    for u, v, w, _, _ in sem_edges:
        sem_deg[u] += 1
        sem_deg[v] += 1
        weight_sum[u] += w
        weight_sum[v] += w
        if primary_hub[u] != primary_hub[v]:
            bridge_hubs[u].add(primary_hub[v])
            bridge_hubs[v].add(primary_hub[u])

    raw_scores = [
        sem_deg[i] * 0.48 + weight_sum[i] * 0.42 + len(bridge_hubs[i]) * 0.38
        for i in range(N)
    ]
    sorted_scores = sorted(raw_scores)
    ref = sorted_scores[int(0.96 * max(0, N - 1))] if sorted_scores else 1.0
    denom = max(ref, 1.0)
    imp = [round(min(1.0, max(0.05, s / denom)), 2) for s in raw_scores]
    return sem_deg, imp


def run_force_layout(
    subset_indices: list[int],
    items: list[dict],
    item_hub_keys: list[list[tuple[str, str]]],
    primary_concepts: list[str | None],
    sem_deg: list[int],
    sem_edges: list[tuple[int, int, float, str, str]],
    aspect_x: float = 1.34,
    aspect_y: float = 0.92,
):
    """Run proportional, subconcept-grouped spatial-hash relaxation + overlap sweep for a node subset."""
    S = len(subset_indices)
    global_to_local = {g: loc for loc, g in enumerate(subset_indices)}

    hub_counts: dict[tuple[str, str], int] = Counter()
    hub_all_counts: dict[tuple[str, str], int] = Counter()
    for g in subset_indices:
        keys = item_hub_keys[g]
        hub_counts[keys[0]] += 1
        for k in keys:
            hub_all_counts[k] += 1

    hubs_ordered: list[tuple[str, str, int]] = []
    present_kinds = [k for k in ("skill", "website", "prompt") if any(item_kind(items[g]) == k for g in subset_indices)]
    for k in present_kinds:
        for t in TOPIC_NAMES["skill" if k == "skill" else "prompt" if k == "prompt" else "website"]:
            c = hub_counts.get((k, t), 0)
            if c > 0:
                hubs_ordered.append((k, t, c))

    H = len(hubs_ordered)
    multi_kind = len(present_kinds) > 1
    sector_gap = 18 if multi_kind else 0
    total_weight = sum(max(10, c) + 6 for _, _, c in hubs_ordered) + max(0, len(present_kinds) * sector_gap)
    max_hub_c = max((c for _, _, c in hubs_ordered), default=1)

    # Ring radius scales naturally with total items + hub count
    base_ring = (235.0 + math.sqrt(S) * 18.5) if multi_kind else (150.0 + math.sqrt(S) * 19.5)
    cur_angle = -math.pi * 0.88
    hub_index: dict[tuple[str, str], int] = {}
    hub_meta: list[dict] = []

    prev_kind = None
    for idx_h, (k, t, c) in enumerate(hubs_ordered):
        if prev_kind is not None and k != prev_kind:
            cur_angle += 2 * math.pi * (sector_gap / total_weight)
        span = 2 * math.pi * ((max(10, c) + 6) / total_weight)
        theta = cur_angle + span * 0.5
        cur_angle += span
        prev_kind = k
        hub_index[(k, t)] = idx_h
        radial_factor = (0.86 + 0.24 * math.sqrt(c / max_hub_c)) + (0.05 if idx_h % 2 else -0.04)
        hx = math.cos(theta) * base_ring * radial_factor * aspect_x
        hy = math.sin(theta) * base_ring * radial_factor * aspect_y
        hub_meta.append({
            "id": f"hub:{k}:{t}",
            "kind": k,
            "topic": t,
            "count": hub_all_counts[(k, t)],
            "primary_count": c,
            "x": hx,
            "y": hy,
        })

    M = S + H
    px = [0.0] * M
    py = [0.0] * M
    vx = [0.0] * M
    vy = [0.0] * M

    for h_i, hnode in enumerate(hub_meta):
        px[S + h_i] = hnode["x"]
        py[S + h_i] = hnode["y"]

    # Partition each hub's primary members by primary concept for coherent sub-sectors
    hub_groups: dict[int, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    primary_hub_of_local: list[int] = [0] * S
    topic_edges_local: list[tuple[int, int, float]] = []
    for loc, g in enumerate(subset_indices):
        primary_h = hub_index[item_hub_keys[g][0]]
        primary_hub_of_local[loc] = primary_h
        ckey = primary_concepts[g] or "~other"
        hub_groups[primary_h][ckey].append(loc)
        topic_edges_local.append((loc, S + primary_h, 0.55))
        for sec_key in item_hub_keys[g][1:]:
            if sec_key in hub_index:
                topic_edges_local.append((loc, S + hub_index[sec_key], 0.30))

    for h_i, groups in hub_groups.items():
        ordered_groups = sorted(
            groups.items(),
            key=lambda kv: (kv[0] == "~other", -len(kv[1]), kv[0]),
        )
        total_m = sum(len(v) for _, v in ordered_groups)
        start_ang = (h_i * 1.1) % (2 * math.pi)
        rank = 0
        for ckey, locs in ordered_groups:
            locs.sort(key=lambda l: (-sem_deg[subset_indices[l]], l))
            span = 2 * math.pi * (len(locs) / max(1, total_m))
            for idx_in_grp, loc in enumerate(locs):
                frac = (idx_in_grp + 0.5) / len(locs)
                ang = start_ang + span * frac + ((idx_in_grp % 3) - 1) * 0.08
                rad = 38.0 + 21.0 * math.sqrt(rank + 0.5)
                px[loc] = px[S + h_i] + math.cos(ang) * rad * 1.12
                py[loc] = py[S + h_i] + math.sin(ang) * rad * 0.94
                rank += 1
            start_ang += span

    sub_sem_edges: list[tuple[int, int, float, bool]] = []
    for u, v, w, _, _ in sem_edges:
        lu = global_to_local.get(u)
        lv = global_to_local.get(v)
        if lu is not None and lv is not None:
            same_hub = item_hub_keys[u][0] == item_hub_keys[v][0]
            same_con = bool(primary_concepts[u] and primary_concepts[u] == primary_concepts[v])
            sub_sem_edges.append((lu, lv, w, same_hub and same_con))

    radius = [
        4.6 + min(4.8, sem_deg[g] * 0.65)
        for g in subset_indices
    ] + [
        15.0 + min(13.0, math.sqrt(h["count"]) * 1.6)
        for h in hub_meta
    ]
    hub_cluster_r = [48.0 + math.sqrt(h["primary_count"]) * 18.0 for h in hub_meta]

    cell_size = 110.0
    inv_cell = 1.0 / cell_size
    iters = 140

    def pair_min_d(u: int, v: int) -> float:
        if u >= S and v >= S:
            return hub_cluster_r[u - S] + hub_cluster_r[v - S] + 45.0
        if u >= S or v >= S:
            return radius[u] + radius[v] + 20.0
        return radius[u] + radius[v] + 24.0

    for step in range(iters):
        cool = 1.0 - step / (iters + 12)
        fx = [0.0] * M
        fy = [0.0] * M

        grid: dict[tuple[int, int], list[int]] = defaultdict(list)
        for u in range(M):
            grid[(int(math.floor(px[u] * inv_cell)), int(math.floor(py[u] * inv_cell)))].append(u)

        for (gx, gy), bucket in grid.items():
            for dx, dy in ((0, 0), (1, 0), (-1, 1), (0, 1), (1, 1)):
                nb = grid.get((gx + dx, gy + dy))
                if not nb:
                    continue
                if dx == 0 and dy == 0:
                    ln = len(bucket)
                    for a_i in range(ln):
                        u = bucket[a_i]
                        for b_i in range(a_i + 1, ln):
                            v = bucket[b_i]
                            rx = px[u] - px[v]
                            ry = py[u] - py[v]
                            d2 = rx * rx + ry * ry + 0.01
                            min_d = pair_min_d(u, v)
                            if d2 < min_d * min_d:
                                d = math.sqrt(d2)
                                push = (min_d - d) * 0.36 / d
                                fx[u] += rx * push
                                fy[u] += ry * push
                                fx[v] -= rx * push
                                fy[v] -= ry * push
                            elif d2 < 9000.0 and u < S and v < S:
                                rep = 460.0 / d2
                                fx[u] += rx * rep
                                fy[u] += ry * rep
                                fx[v] -= rx * rep
                                fy[v] -= ry * rep
                else:
                    for u in bucket:
                        for v in nb:
                            rx = px[u] - px[v]
                            ry = py[u] - py[v]
                            d2 = rx * rx + ry * ry + 0.01
                            min_d = pair_min_d(u, v)
                            if d2 < min_d * min_d:
                                d = math.sqrt(d2)
                                push = (min_d - d) * 0.36 / d
                                fx[u] += rx * push
                                fy[u] += ry * push
                                fx[v] -= rx * push
                                fy[v] -= ry * push
                            elif d2 < 9000.0 and u < S and v < S:
                                rep = 460.0 / d2
                                fx[u] += rx * rep
                                fy[u] += ry * rep
                                fx[v] -= rx * rep
                                fy[v] -= ry * rep

        # Hub-hub separation proportional to cluster territories
        for a in range(S, M):
            for b in range(a + 1, M):
                rx = px[a] - px[b]
                ry = py[a] - py[b]
                d2 = rx * rx + ry * ry + 1.0
                target_sep = hub_cluster_r[a - S] + hub_cluster_r[b - S] + 55.0
                if d2 < target_sep * target_sep:
                    d = math.sqrt(d2)
                    push = (target_sep - d) * 0.24 / d
                    fx[a] += rx * push
                    fy[a] += ry * push
                    fx[b] -= rx * push
                    fy[b] -= ry * push

        # Topic springs proportional to cluster population
        for loc, h_node_idx, w in topic_edges_local:
            rx = px[h_node_idx] - px[loc]
            ry = py[h_node_idx] - py[loc]
            d = math.hypot(rx, ry) + 0.01
            pcount = hub_meta[h_node_idx - S]["primary_count"]
            rest = 44.0 + math.sqrt(pcount) * 16.0
            k_spring = 0.095 if w > 0.4 else 0.005
            delta = (d - rest) * k_spring / d
            fx[loc] += rx * delta
            fy[loc] += ry * delta
            if w > 0.4:
                h_pull = 0.085 / max(1.0, math.sqrt(pcount))
                fx[h_node_idx] -= rx * delta * h_pull
                fy[h_node_idx] -= ry * delta * h_pull

        # Semantic springs (gentle across distinct hubs so small clusters stay intact)
        for lu, lv, w, tight in sub_sem_edges:
            rx = px[lv] - px[lu]
            ry = py[lv] - py[lu]
            d = math.hypot(rx, ry) + 0.01
            same_primary = primary_hub_of_local[lu] == primary_hub_of_local[lv]
            if tight:
                rest = 38.0 + (1.0 - w) * 24.0
                ks = 0.052 + w * 0.04
            elif same_primary:
                rest = 48.0 + (1.0 - w) * 32.0
                ks = 0.035 + w * 0.03
            else:
                rest = 85.0 + (1.0 - w) * 60.0
                ks = 0.012 + w * 0.015
            delta = (d - rest) * ks / d
            fx[lu] += rx * delta
            fy[lu] += ry * delta
            fx[lv] -= rx * delta
            fy[lv] -= ry * delta

        for u in range(M):
            grav_x = 0.008 if u >= S else 0.003
            grav_y = 0.012 if u >= S else 0.0045
            fx[u] -= px[u] * grav_x
            fy[u] -= py[u] * grav_y

            vx[u] = (vx[u] + fx[u] * cool) * 0.72
            vy[u] = (vy[u] + fy[u] * cool) * 0.72
            spd = math.hypot(vx[u], vy[u])
            max_spd = 26.0 * cool + 2.0
            if spd > max_spd:
                s = max_spd / spd
                vx[u] *= s
                vy[u] *= s
            px[u] += vx[u]
            py[u] += vy[u]

    # Deterministic final overlap-separation sweep so dots never stack
    sweep_cell = 56.0
    inv_sweep = 1.0 / sweep_cell
    for _ in range(6):
        sgrid: dict[tuple[int, int], list[int]] = defaultdict(list)
        for u in range(M):
            sgrid[(int(math.floor(px[u] * inv_sweep)), int(math.floor(py[u] * inv_sweep)))].append(u)
        for (gx, gy), bucket in sgrid.items():
            for dx, dy in ((0, 0), (1, 0), (-1, 1), (0, 1), (1, 1)):
                nb = sgrid.get((gx + dx, gy + dy))
                if not nb:
                    continue
                pairs = (
                    ((bucket[a], bucket[b]) for a in range(len(bucket)) for b in range(a + 1, len(bucket)))
                    if (dx == 0 and dy == 0)
                    else ((u, v) for u in bucket for v in nb)
                )
                for u, v in pairs:
                    if u >= S and v >= S:
                        continue
                    min_sep = (radius[u] + radius[v] + 22.0) if (u >= S or v >= S) else 38.0
                    rx = px[u] - px[v]
                    ry = py[u] - py[v]
                    d2 = rx * rx + ry * ry
                    if d2 < min_sep * min_sep:
                        d = math.sqrt(d2) if d2 > 1e-6 else 1.0
                        if d2 <= 1e-6:
                            rx, ry = 1.0, 0.2
                        overlap = (min_sep - d) * 0.52 / d
                        if u >= S:
                            px[v] -= rx * overlap * 1.4
                            py[v] -= ry * overlap * 1.4
                        elif v >= S:
                            px[u] += rx * overlap * 1.4
                            py[u] += ry * overlap * 1.4
                        else:
                            px[u] += rx * overlap
                            py[u] += ry * overlap
                            px[v] -= rx * overlap
                            py[v] -= ry * overlap

    # Center final bounding box cleanly at (0, 0)
    cx = sum(px) / max(1, M)
    cy = sum(py) / max(1, M)
    for u in range(M):
        px[u] -= cx
        py[u] -= cy

    hub_dists: dict[int, list[float]] = defaultdict(list)
    for loc, g in enumerate(subset_indices):
        primary_h = hub_index[item_hub_keys[g][0]]
        hub_dists[primary_h].append(math.hypot(px[loc] - px[S + primary_h], py[loc] - py[S + primary_h]))

    hub_coords: dict[str, tuple[float, float, float]] = {}
    for h_i, hnode in enumerate(hub_meta):
        ds = sorted(hub_dists.get(h_i, []))
        r88 = ds[int(0.88 * (len(ds) - 1))] if ds else 32.0
        tr = round(max(62.0, min(280.0, r88 + 26.0)), 1)
        hub_coords[hnode["id"]] = (round(px[S + h_i], 1), round(py[S + h_i], 1), tr)

    node_coords = {
        subset_indices[loc]: (round(px[loc], 1), round(py[loc], 1))
        for loc in range(S)
    }
    return hub_coords, node_coords


def layout_graph(
    items: list[dict],
    sem_edges: list[tuple[int, int, float, str, str]],
    primary_concepts: list[str | None],
):
    """Run global + per-section proportional force-directed layouts."""
    N = len(items)
    sem_deg, imp = compute_node_importance(items, sem_edges)
    item_hub_keys: list[list[tuple[str, str]]] = [
        [(item_kind(it), t) for t in item_topics(it)]
        for it in items
    ]

    all_indices = list(range(N))
    global_hubs, global_nodes = run_force_layout(
        all_indices, items, item_hub_keys, primary_concepts, sem_deg, sem_edges, aspect_x=1.34, aspect_y=0.92
    )

    sec_hubs: dict[str, tuple[float, float, float]] = {}
    sec_nodes: dict[int, tuple[float, float]] = {}
    for kind in ("skill", "website", "prompt"):
        sub = [i for i in range(N) if item_kind(items[i]) == kind]
        if not sub:
            continue
        sh, sn = run_force_layout(
            sub, items, item_hub_keys, primary_concepts, sem_deg, sem_edges, aspect_x=1.36, aspect_y=0.90
        )
        sec_hubs.update(sh)
        sec_nodes.update(sn)

    # Assemble hub nodes ordered stably
    hub_all_counts: dict[tuple[str, str], int] = Counter()
    for keys in item_hub_keys:
        for k in keys:
            hub_all_counts[k] += 1

    hub_nodes = []
    topic_edges: list[tuple[int, str, float]] = []
    present_hubs: set[str] = set()
    for k in ("skill", "website", "prompt"):
        for t in TOPIC_NAMES["skill" if k == "skill" else "prompt" if k == "prompt" else "website"]:
            hid = f"hub:{k}:{t}"
            if hid in global_hubs:
                gx, gy, gtr = global_hubs[hid]
                sx, sy, str_ = sec_hubs.get(hid, (gx, gy, gtr))
                hub_nodes.append({
                    "id": hid,
                    "kind": k,
                    "topic": t,
                    "count": hub_all_counts[(k, t)],
                    "x": gx,
                    "y": gy,
                    "tr": gtr,
                    "sx": sx,
                    "sy": sy,
                    "str": str_,
                })
                present_hubs.add(hid)

    for i in range(N):
        keys = item_hub_keys[i]
        primary_id = f"hub:{keys[0][0]}:{keys[0][1]}"
        topic_edges.append((i, primary_id, 0.55))
        for sk, st in keys[1:]:
            sec_id = f"hub:{sk}:{st}"
            if sec_id in present_hubs:
                topic_edges.append((i, sec_id, 0.30))

    used_concepts = {c for c in primary_concepts if c}
    concepts_out = {
        cid: [CONCEPT_META[cid][1], CONCEPT_META[cid][2]]
        for cid, _, _, _, _ in CONCEPT_DEFS
        if cid in used_concepts
    }

    item_nodes = []
    for i in range(N):
        gx, gy = global_nodes[i]
        sx, sy = sec_nodes.get(i, (gx, gy))
        node_obj = {
            "id": items[i]["id"],
            "hub": f"hub:{item_hub_keys[i][0][0]}:{item_hub_keys[i][0][1]}",
            "deg": sem_deg[i],
            "imp": imp[i],
            "x": gx,
            "y": gy,
            "sx": sx,
            "sy": sy,
        }
        if primary_concepts[i]:
            node_obj["c"] = primary_concepts[i]
        item_nodes.append(node_obj)

    edges_out = []
    for u, v, w, rz, re_ in sem_edges:
        edges_out.append({
            "s": items[u]["id"],
            "t": items[v]["id"],
            "k": "r",
            "w": w,
            "rz": rz,
            "re": re_,
        })
    for u, hid, w in topic_edges:
        edges_out.append({
            "s": items[u]["id"],
            "t": hid,
            "k": "t",
            "w": round(w, 2),
        })

    return {
        "version": 2,
        "stats": {
            "items": N,
            "hubs": len(hub_nodes),
            "relEdges": len(sem_edges),
            "topicEdges": len(topic_edges),
        },
        "concepts": concepts_out,
        "hubs": hub_nodes,
        "nodes": item_nodes,
        "edges": edges_out,
    }


def build(root: Path, items: list[dict]) -> str:
    tfidf_vecs, feat_labels, idf, owners, primary_concepts = build_features(items)
    sem_edges = compute_semantic_edges(items, tfidf_vecs, feat_labels, idf, owners)
    graph = layout_graph(items, sem_edges, primary_concepts)
    out_path = root / "assets" / "knowledge-graph.json"
    compact = json.dumps(graph, ensure_ascii=False, separators=(",", ":"))
    out_path.write_text(compact, encoding="utf-8")
    return compact


if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    items = json.loads((root / "prompts.json").read_text(encoding="utf-8"))
    compact = build(root, items)
    g = json.loads(compact)
    print(
        f"Built knowledge-graph.json ({len(compact) / 1024:.1f} KB, v{g['version']}): "
        f"{g['stats']['items']} items, {g['stats']['hubs']} hubs, "
        f"{g['stats']['relEdges']} semantic edges, {g['stats']['topicEdges']} topic edges"
    )
