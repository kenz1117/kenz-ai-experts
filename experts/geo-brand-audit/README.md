# 品牌GEO顾问 (Brand GEO Advisor)

用可核查的公开证据审计品牌在 AI 搜索里的可见度：六维评分（RETRIEVABILITY / AUTHORITY / CONTENT_ASSETS / STRUCTURE_MARKUP / SENTIMENT / COMPETITIVE）、证据分级 L1–L3、竞品共现涌现，产出 HTML 汇报版 + Markdown 执行清单。

- **类型**：Agent 型（单个 AI 专家，顺序跑完 4 阶段流水线）
- **职业**：品牌GEO可见度审计顾问 / Brand GEO Visibility Audit Consultant
- **分类**：05-营销增长 (MarketingGrowth)
- **作者**：KenZ · https://github.com/kenz1117

## 核心能力

- **证据驱动**：每分标注 L1 已验证 / L2 检索命中 / L3 推演估计，并给出证据覆盖率，拒绝空口评分
- **六维评分**：可核查权重 RETRIEVABILITY 25% / AUTHORITY 20% / CONTENT_ASSETS 15% / STRUCTURE_MARKUP 15% / SENTIMENT 15% / COMPETITIVE 10%
- **分档采集**：quick / standard / deep 三档，按需控制检索深度与成本
- **竞品共现**：检索竞品在 AI 答案中的共现与涌现，定位差异化机会
- **交互式**：缺品牌名 / 品类 / 档位 / 竞品 / 上次对比 JSON 时，主动用选项向用户确认，不自作主张
- **交付物**：HTML 汇报版（数据新闻风 + 品牌 logo + 六维瀑布图 + 雷达图 + 根因链 + 2×2 矩阵）+ Markdown 执行版（P0/P1/P2 行动清单）

## 使用示例

- 帮我审计一下〔品牌〕在 AI 搜索里的可见度（standard 档）
- 出一份〔品牌〕的 GEO 诊断报告，含六维评分和竞品对比
- 和上次的报告比一下，看〔品牌〕这月的 GEO 优化效果（需要上次的 JSON）

## 头像

`avatars/expert.jpg`（512×512，red-orange 背景，05-营销增长风格）。如需替换：PNG 或 JPG、512×512、≤500KB，直接覆盖同名文件即可。

## 安装（WorkBuddy 专家目录）

将本目录放到专家目录下并注册：

```bash
# 复制到专家目录
cp -R experts/geo-brand-audit \
  /Users/ken/.workbuddy/plugins/marketplaces/my-experts/plugins/

# 注册，使其在专家中心可见
python3 ~/.workbuddy/plugins/cache/workbuddy-builtin/skill-expert-manager/0.1.0/scripts/register_expert.py \
  /Users/ken/.workbuddy/plugins/marketplaces/my-experts/plugins/geo-brand-audit
```

## 打包分享

```bash
python3 ~/.workbuddy/plugins/cache/workbuddy-builtin/skill-expert-manager/0.1.0/scripts/package_expert.py \
  /Users/ken/.workbuddy/plugins/marketplaces/my-experts/plugins/geo-brand-audit \
  ./dist/
# 产出 dist/geo-brand-audit.zip，可分享/重装
```
