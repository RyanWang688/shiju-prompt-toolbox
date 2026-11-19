"""Build-time semantic relationship extraction and pre-warmed force layout for the Knowledge Graph."""
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
        "remotion", "video", "视频剪辑", "视频复刻", "动画视频", "短视频", "口播视频", "ai剪辑", "视频高光", "镜头拆解", "动画短片", "竖屏动画", "ffmpeg", "after effects",
    ]),
    ("c:coding-agent", 2.8, "AI 编程助手", "AI Coding Agents", [
        "claude code", "codex", "cursor", "windsurf", "coding agent", "ai编程", "编程agent", "终端agent", "opencode",
    ]),
    ("c:mcp", 2.9, "MCP 协议", "MCP Protocol", [
        "mcp", "model context protocol",
    ]),
    ("c:multi-agent", 3.0, "多智能体协作", "Multi-Agent Systems", [
        "多智能体", "多智能体编排", "多智能体协作", "多agent协同", "multi-agent", "multi agent", "agent team", "ai团队", "数字员工", "ai专家团队",
    ]),
    ("c:monitor", 3.3, "网页与补货监控", "Web & Stock Monitors", [
        "补货监控", "库存监控", "网页监控", "vps监控", "sku监控", "京东监控", "价格监控", "restock", "stock monitor", "web monitor", "vps monitor", "sku monitor",
    ]),
    ("c:ecom", 3.1, "电商视觉与运营", "E-Commerce & Ads", [
        "电商做图", "跨境电商", "e-commerce", "shopee", "mercado livre", "producthero", "/ugc model", "/meta ads", "/explodedview", "/3dbillboard", "/producthero",
    ]),
    ("c:english", 3.3, "英语与学习工具", "Language & Learning", [
        "英语学习", "背单词", "打字记忆", "四六级雅思", "english learning", "vocabulary", "ielts", "toefl", "教材",
    ]),
    ("c:reverse", 3.1, "逆向分析与复刻", "Reverse Engineering", [
        "逆向工程", "逆向分析", "净室复刻", "clean-room", "reverse engineering", "video recreation", "rea", "镜头拆解",
    ]),
    ("c:react-ui", 2.8, "React / 组件库", "React & UI Kits", [
        "react", "tailwind", "shadcn", "组件库", "组件动画库", "ui框架", "ui framework", "framer motion", "motion",
    ]),
    ("c:ui-design", 2.8, "UI 审美与设计系统", "UI & Design Systems", [
        "ui设计", "ui design", "设计系统", "design system", "去ai味", "de-slop", "卡片交互", "按钮交互", "导航设计", "下拉菜单",
    ]),
    ("c:context", 3.1, "上下文与 Token 优化", "Context & Token Opt", [
        "上下文压缩", "context pruning", "context compression", "省token", "token-saving", "上下文管理",
    ]),
    ("c:writing", 2.9, "写作与科研辅助", "Writing & Research", [
        "小说创作", "学术论文", "科研写作", "科研副导师", "学术研究", "写作创作", "去ai腔", "paper writing", "vibe research", "academic research",
    ]),
    ("c:downloader", 3.3, "多线程下载工具", "Download Managers", [
        "下载器", "下载工具", "多线程下载", "bt磁力", "idm替代", "download manager", "bittorrent", "magnet",
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
    ]),
    ("c:devtools", 2.7, "代码审查与测试治理", "Review, QA & Governance", [
        "代码审查", "code review", "tdd", "测试驱动", "安全审计", "security audit", "bug定位", "仓库治理", "repo governance",
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
    "using", "build", "make", "more", "fast", "simple", "modern", "native", "local", "style", "page", "pages", "site",
    "sites", "project", "github", "skill", "skills", "agent", "agents", "prompt", "prompts", "html", "css", "json",
    "api", "one", "all", "new", "high", "auto", "multi", "custom", "real", "full", "text", "view", "mode", "card",
    "cards", "help", "work", "workflow", "workflows", "guide", "official", "readme", "example", "demo", "line",
    "system", "like", "you", "can", "via", "without", "over", "any", "into", "when", "how", "are", "not", "only",
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
                # Try substring concept match on multi-word tags
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

    # Filter out singletons to keep vectors lean, attach raw tag labels
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
    for fdict in item_feats:
        vec = {f: w * idf[f] for f, w in fdict.items() if f in idf}
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
        tfidf_vecs.append({f: v / norm for f, v in vec.items()})

    return tfidf_vecs, feat_labels, idf, owners


def compute_semantic_edges(items: list[dict], tfidf_vecs: list[dict[str, float]], feat_labels: dict[str, tuple[str, str]], idf: dict[str, float], owners: list[str | None]):
    N = len(items)
    # Inverted index for fast candidate generation (instead of blind O(N^2) work)
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
            # Slightly discount pure topic-only overlap unless backed by another feature
            is_topic_only = f.startswith("topic:")
            for j in inv[f]:
                if j <= i:
                    continue
                contrib = vi * tfidf_vecs[j][f]
                if not is_topic_only:
                    scores[j] += contrib
                    prev = best_feat.get(j)
                    # Prefer explicit concept / tag / owner reasons over generic keywords
                    reason_prio = contrib * (1.8 if f.startswith(("c:", "owner:", "tag:")) else 0.7)
                    if not prev or reason_prio > prev[0]:
                        best_feat[j] = (reason_prio, f)
                else:
                    # Only record topic contribution if they share something else too (applied below)
                    scores[j] += contrib * 0.45

        kind_i = item_kind(items[i])
        top_i = item_topics(items[i])[0]
        for j, sim in scores.items():
            if j not in best_feat:
                continue  # Never link items solely on a broad category without a shared tag/concept/keyword
            # Same-owner boost
            if owners[i] and owners[i] == owners[j]:
                sim += 0.28
                best_feat[j] = (99.0, f"owner:{owners[i]}")
            # Mild same-subcluster affinity so intra-topic neighbors cohere cleanly
            if item_kind(items[j]) == kind_i and item_topics(items[j])[0] == top_i:
                sim += 0.04
            sim = min(0.99, sim)
            if sim < 0.24:
                continue
            bf = best_feat[j][1]
            rz, re_ = feat_labels.get(bf, ("相关特性", "Related"))
            candidates_per_node[i].append((sim, j, rz, re_))
            candidates_per_node[j].append((sim, i, rz, re_))

    # Top-K sparse pruning with mutual-top-2 preservation & anti-hairball cap (max 6)
    top_k_sets: list[set[int]] = []
    for i in range(N):
        candidates_per_node[i].sort(key=lambda x: -x[0])
        top_k_sets.append({j for _, j, _, _ in candidates_per_node[i][:3]})

    chosen: dict[tuple[int, int], tuple[float, str, str]] = {}
    deg = [0] * N

    # Pass 1: Mutual top-3 strong pairs first
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

    # Pass 2: Guarantee every node with candidates gets at least 2 neighbors if possible
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


def layout_graph(items: list[dict], sem_edges: list[tuple[int, int, float, str, str]]):
    """Run a fast, deterministic spatial-hash force-directed relaxation for crisp instant paint."""
    N = len(items)
    # Build hubs ordered proportionally by kind sector
    hub_counts: dict[tuple[str, str], int] = Counter()
    item_hub_keys: list[list[tuple[str, str]]] = []
    for it in items:
        k = item_kind(it)
        ts = item_topics(it)
        keys = [(k, t) for t in ts]
        item_hub_keys.append(keys)
        hub_counts[keys[0]] += 1
        # Secondary topic edge tracked for cross-topic bridging if small count
        for sec in keys[1:2]:
            hub_counts[sec] += 0

    hubs_ordered: list[tuple[str, str, int]] = []
    kind_totals: dict[str, int] = defaultdict(int)
    for k in ("skill", "website", "prompt"):
        for t in TOPIC_NAMES["skill" if k == "skill" else "prompt" if k == "prompt" else "website"]:
            c = hub_counts.get((k, t), 0)
            if c > 0:
                hubs_ordered.append((k, t, c))
                kind_totals[k] += c

    # Assign angular coordinates around ellipse (1.28:1 landscape friendly)
    total_weight = sum(max(8, c) for _, _, c in hubs_ordered) + 3 * 14  # 14 weight padding between 3 sectors
    cur_angle = -math.pi * 0.88
    hub_index: dict[tuple[str, str], int] = {}
    hub_nodes = []

    prev_kind = None
    for idx_h, (k, t, c) in enumerate(hubs_ordered):
        if prev_kind is not None and k != prev_kind:
            cur_angle += 2 * math.pi * (14 / total_weight)
        span = 2 * math.pi * (max(8, c) / total_weight)
        theta = cur_angle + span * 0.5
        cur_angle += span
        prev_kind = k
        hub_index[(k, t)] = idx_h
        r_ring = 520 + (45 if idx_h % 2 else -25)
        hx = math.cos(theta) * r_ring * 1.24
        hy = math.sin(theta) * r_ring * 0.90
        hub_nodes.append({
            "id": f"hub:{k}:{t}",
            "kind": k,
            "topic": t,
            "count": sum(1 for keys in item_hub_keys if (k, t) in keys),
            "x": hx,
            "y": hy,
        })

    H = len(hub_nodes)
    # Seed item nodes in a golden-angle spiral around their primary hub
    golden = math.pi * (3 - math.sqrt(5))
    hub_member_idx: dict[int, int] = defaultdict(int)
    px = [0.0] * (N + H)
    py = [0.0] * (N + H)
    vx = [0.0] * (N + H)
    vy = [0.0] * (N + H)

    for h_i, hnode in enumerate(hub_nodes):
        px[N + h_i] = hnode["x"]
        py[N + h_i] = hnode["y"]

    topic_edges: list[tuple[int, int, float]] = []
    for i in range(N):
        primary_h = hub_index[item_hub_keys[i][0]]
        m = hub_member_idx[primary_h]
        hub_member_idx[primary_h] += 1
        ang = m * golden
        rad = 42 + 16.5 * math.sqrt(m + 1)
        px[i] = px[N + primary_h] + math.cos(ang) * rad * 1.1
        py[i] = py[N + primary_h] + math.sin(ang) * rad * 0.95
        topic_edges.append((i, N + primary_h, 0.55))
        for sec_key in item_hub_keys[i][1:2]:
            if sec_key in hub_index:
                topic_edges.append((i, N + hub_index[sec_key], 0.30))

    # Precompute node target radius for collision avoidance
    sem_deg = [0] * N
    for i, j, _, _, _ in sem_edges:
        sem_deg[i] += 1
        sem_deg[j] += 1

    radius = [
        4.2 + min(4.5, sem_deg[i] * 0.65)
        for i in range(N)
    ] + [
        15.0 + min(12.0, math.sqrt(hub_nodes[h]["count"]) * 1.5)
        for h in range(H)
    ]

    # Spatial-hash force relaxation (110 iterations, < 0.3s)
    M = N + H
    cell_size = 135.0
    inv_cell = 1.0 / cell_size
    iters = 110

    for step in range(iters):
        cool = 1.0 - step / (iters + 10)
        fx = [0.0] * M
        fy = [0.0] * M

        # Spatial grid for local repulsion & collision
        grid: dict[tuple[int, int], list[int]] = defaultdict(list)
        for u in range(M):
            grid[(int(math.floor(px[u] * inv_cell)), int(math.floor(py[u] * inv_cell)))].append(u)

        for (gx, gy), bucket in grid.items():
            # Collect neighbor cells in half-plane to visit each pair once
            neighbors: list[int] = []
            for dx, dy in ((0, 0), (1, 0), (-1, 1), (0, 1), (1, 1)):
                nb = grid.get((gx + dx, gy + dy))
                if not nb:
                    continue
                if dx == 0 and dy == 0:
                    ln = len(nb)
                    for a_i in range(ln):
                        u = nb[a_i]
                        for b_i in range(a_i + 1, ln):
                            v = nb[b_i]
                            rx = px[u] - px[v]
                            ry = py[u] - py[v]
                            d2 = rx * rx + ry * ry + 0.01
                            min_d = radius[u] + radius[v] + (95.0 if (u >= N and v >= N) else 34.0 if (u >= N or v >= N) else 20.0)
                            if d2 < min_d * min_d:
                                d = math.sqrt(d2)
                                push = (min_d - d) * 0.34 / d
                                fx[u] += rx * push
                                fy[u] += ry * push
                                fx[v] -= rx * push
                                fy[v] -= ry * push
                            elif d2 < 24000.0:
                                rep = (2400.0 if (u >= N or v >= N) else 620.0) / d2
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
                            min_d = radius[u] + radius[v] + (95.0 if (u >= N and v >= N) else 34.0 if (u >= N or v >= N) else 20.0)
                            if d2 < min_d * min_d:
                                d = math.sqrt(d2)
                                push = (min_d - d) * 0.34 / d
                                fx[u] += rx * push
                                fy[u] += ry * push
                                fx[v] -= rx * push
                                fy[v] -= ry * push
                            elif d2 < 24000.0:
                                rep = (2400.0 if (u >= N or v >= N) else 620.0) / d2
                                fx[u] += rx * rep
                                fy[u] += ry * rep
                                fx[v] -= rx * rep
                                fy[v] -= ry * rep

        # Hub-hub extra global separation so clusters never collide
        for a in range(N, M):
            for b in range(a + 1, M):
                rx = px[a] - px[b]
                ry = py[a] - py[b]
                d2 = rx * rx + ry * ry + 1.0
                if d2 < 120000.0:
                    rep = 14000.0 / d2
                    fx[a] += rx * rep
                    fy[a] += ry * rep
                    fx[b] -= rx * rep
                    fy[b] -= ry * rep

        # Topic springs (keep clusters cohesive around their topic hubs)
        for u, h_node_idx, w in topic_edges:
            rx = px[h_node_idx] - px[u]
            ry = py[h_node_idx] - py[u]
            d = math.hypot(rx, ry) + 0.01
            rest = 78.0 + math.sqrt(hub_nodes[h_node_idx - N]["count"]) * 12.0
            k_spring = 0.055 if w > 0.4 else 0.014
            delta = (d - rest) * k_spring / d
            fx[u] += rx * delta
            fy[u] += ry * delta
            fx[h_node_idx] -= rx * delta * 0.08
            fy[h_node_idx] -= ry * delta * 0.08

        # Semantic springs (pull strongly related items close together cleanly)
        for u, v, w, _, _ in sem_edges:
            rx = px[v] - px[u]
            ry = py[v] - py[u]
            d = math.hypot(rx, ry) + 0.01
            rest = 42.0 + (1.0 - w) * 48.0
            delta = (d - rest) * (0.04 + w * 0.04) / d
            fx[u] += rx * delta
            fy[u] += ry * delta
            fx[v] -= rx * delta
            fy[v] -= ry * delta

        # Gentle centering gravity (slightly flatter vertically for wide viewports)
        for u in range(M):
            grav_x = 0.008 if u >= N else 0.004
            grav_y = 0.013 if u >= N else 0.006
            fx[u] -= px[u] * grav_x
            fy[u] -= py[u] * grav_y

            vx[u] = (vx[u] + fx[u] * cool) * 0.72
            vy[u] = (vy[u] + fy[u] * cool) * 0.72
            # Clamp max velocity per step for stability
            spd = math.hypot(vx[u], vy[u])
            max_spd = 26.0 * cool + 2.0
            if spd > max_spd:
                s = max_spd / spd
                vx[u] *= s
                vy[u] *= s
            px[u] += vx[u]
            py[u] += vy[u]

    # Center final bounding box at (0, 0)
    cx = sum(px) / M
    cy = sum(py) / M
    for u in range(M):
        px[u] -= cx
        py[u] -= cy

    for h_i, hnode in enumerate(hub_nodes):
        hnode["x"] = round(px[N + h_i], 1)
        hnode["y"] = round(py[N + h_i], 1)

    item_nodes = [
        {
            "id": items[i]["id"],
            "hub": hub_nodes[hub_index[item_hub_keys[i][0]]]["id"],
            "deg": sem_deg[i],
            "x": round(px[i], 1),
            "y": round(py[i], 1),
        }
        for i in range(N)
    ]

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
    for u, h_node_idx, w in topic_edges:
        edges_out.append({
            "s": items[u]["id"],
            "t": hub_nodes[h_node_idx - N]["id"],
            "k": "t",
            "w": round(w, 2),
        })

    return {
        "version": 1,
        "stats": {
            "items": N,
            "hubs": H,
            "relEdges": len(sem_edges),
            "topicEdges": len(topic_edges),
        },
        "hubs": hub_nodes,
        "nodes": item_nodes,
        "edges": edges_out,
    }


def build(root: Path, items: list[dict]) -> str:
    tfidf_vecs, feat_labels, idf, owners = build_features(items)
    sem_edges = compute_semantic_edges(items, tfidf_vecs, feat_labels, idf, owners)
    graph = layout_graph(items, sem_edges)
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
        f"Built knowledge-graph.json ({len(compact) / 1024:.1f} KB): "
        f"{g['stats']['items']} items, {g['stats']['hubs']} hubs, "
        f"{g['stats']['relEdges']} semantic edges, {g['stats']['topicEdges']} topic edges"
    )
