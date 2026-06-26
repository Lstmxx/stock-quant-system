#!/usr/bin/env python3
"""Generate final formatted GitHub Trending report with filtering."""

import json
from datetime import datetime

# Load data
with open('/tmp/trending_daily.json', 'r') as f:
    daily_repos = json.load(f)

with open('/tmp/trending_weekly.json', 'r') as f:
    weekly_repos = json.load(f)

with open('/tmp/repo_details.json', 'r') as f:
    repo_details = json.load(f)

# Filter out low-quality repos
def is_valid_repo(repo, details=None):
    """Check if repo is worth including."""
    name = repo.get('name', '')
    
    # Skip if no name
    if not name:
        return False
    
    # Skip if no description and low stars
    if details:
        desc = details.get('description', '')
        stars = details.get('stars', 0)
        if not desc and stars < 1000:
            return False
        if details.get('archived', False):
            return False
    
    return True

# Auto-generate Chinese description and tags
def generate_insight(repo, details=None):
    """Generate Chinese insight for a repo."""
    name = repo.get('name', '')
    desc = (details or {}).get('description', '') or repo.get('description', '')
    topics = (details or {}).get('topics', [])
    language = repo.get('language', '')
    stars = (details or {}).get('stars', 0)
    
    # Determine track/tag
    tags = []
    
    # AI/LLM related
    ai_keywords = ['ai', 'llm', 'gpt', 'claude', 'model', 'agent', 'embedding', 'vector', 'rag', 'openai', 'anthropic', 'copilot', 'cursor', 'codex']
    if any(kw in name.lower() or kw in desc.lower() or kw in ' '.join(topics).lower() for kw in ai_keywords):
        tags.append('AI大模型')
    
    # Agent related
    agent_keywords = ['agent', 'agentic', 'coding-agent', 'autonomous']
    if any(kw in name.lower() or kw in desc.lower() or kw in ' '.join(topics).lower() for kw in agent_keywords):
        tags.append('Agent')
    
    # Frontend/Backend framework
    framework_keywords = ['framework', 'runtime', 'bundler', 'react', 'vue', 'angular', 'nextjs', 'svelte']
    if any(kw in name.lower() or kw in desc.lower() or kw in ' '.join(topics).lower() for kw in framework_keywords):
        tags.append('前后端框架')
    
    # Security tools
    security_keywords = ['security', 'stealth', 'fingerprint', 'bypass', 'anti-detect', 'scraper', 'pentest', 'vulnerability']
    if any(kw in name.lower() or kw in desc.lower() or kw in ' '.join(topics).lower() for kw in security_keywords):
        tags.append('安全工具')
    
    # Automation
    auto_keywords = ['automation', 'automate', 'workflow', 'pipeline', 'ci', 'cd', 'devops']
    if any(kw in name.lower() or kw in desc.lower() or kw in ' '.join(topics).lower() for kw in auto_keywords):
        tags.append('自动化')
    
    # Finance
    finance_keywords = ['finance', 'trading', 'quant', 'stock', 'market', 'investment', 'fintech', 'bloomberg']
    if any(kw in name.lower() or kw in desc.lower() or kw in ' '.join(topics).lower() for kw in finance_keywords):
        tags.append('量化金融')
    
    # Chinese open source
    if any('\u4e00' <= c <= '\u9fff' for c in desc) or 'china' in ' '.join(topics).lower() or 'chinese' in ' '.join(topics).lower():
        tags.append('国产开源')
    
    # Developer tools
    dev_keywords = ['developer', 'devtools', 'debug', 'ide', 'editor', 'terminal', 'cli', 'tool']
    if any(kw in name.lower() or kw in desc.lower() or kw in ' '.join(topics).lower() for kw in dev_keywords):
        if '开发工具' not in tags:
            tags.append('开发工具')
    
    # Knowledge/Education
    edu_keywords = ['learn', 'course', 'tutorial', 'education', 'knowledge', 'book', 'guide', 'skills']
    if any(kw in name.lower() or kw in desc.lower() or kw in ' '.join(topics).lower() for kw in edu_keywords):
        tags.append('学习资源')
    
    # If no tags, add generic
    if not tags:
        if language in ['Python', 'JavaScript', 'TypeScript']:
            tags.append('开发工具')
        else:
            tags.append('开源项目')
    
    # Generate brief Chinese description
    brief = desc[:100] if desc else '暂无描述'
    
    return {
        'tags': tags[:3],  # Max 3 tags
        'brief': brief
    }

# Format star count
def format_stars(count):
    """Format star count."""
    if isinstance(count, str):
        count = count.replace(',', '').strip()
        try:
            count = int(count)
        except:
            return count
    
    if count >= 1000:
        return f"{count/1000:.1f}k"
    return str(count)

# Generate report
def generate_report():
    """Generate the full report."""
    today = datetime.now().strftime('%Y年%m月%d日')
    
    report = []
    report.append(f"📊 GitHub Trending 榜单日报")
    report.append(f"📅 {today}")
    report.append("")
    
    # Daily section
    report.append("=" * 50)
    report.append("【GitHub Trending 日榜】")
    report.append("=" * 50)
    report.append("")
    
    daily_count = 0
    for repo in daily_repos:
        name = repo.get('name', '')
        details = repo_details.get(name, {})
        
        if not is_valid_repo(repo, details):
            continue
        
        daily_count += 1
        insight = generate_insight(repo, details)
        
        # Format line
        lang = repo.get('language', 'N/A') or 'N/A'
        stars = format_stars(details.get('stars', repo.get('total_stars', '')))
        tags_str = '、'.join(insight['tags'])
        
        report.append(f"{daily_count}. {name}【{lang}】")
        report.append(f"   ⭐ {stars} | {tags_str}")
        report.append(f"   📌 {insight['brief']}")
        report.append("")
    
    # Weekly section
    report.append("=" * 50)
    report.append("【GitHub Trending 周榜】")
    report.append("=" * 50)
    report.append("")
    
    weekly_count = 0
    for repo in weekly_repos:
        name = repo.get('name', '')
        details = repo_details.get(name, {})
        
        if not is_valid_repo(repo, details):
            continue
        
        weekly_count += 1
        insight = generate_insight(repo, details)
        
        # Format line
        lang = repo.get('language', 'N/A') or 'N/A'
        stars = format_stars(details.get('stars', repo.get('total_stars', '')))
        week_stars = repo.get('stars_today', '')
        tags_str = '、'.join(insight['tags'])
        
        report.append(f"{weekly_count}. {name}【{lang}】")
        report.append(f"   ⭐ {stars} (+{week_stars}) | {tags_str}")
        report.append(f"   📌 {insight['brief']}")
        report.append("")
    
    # Summary section
    report.append("=" * 50)
    report.append("【趋势总结】")
    report.append("=" * 50)
    report.append("")
    
    # Language distribution
    lang_count = {}
    for repo in daily_repos + weekly_repos:
        lang = repo.get('language', 'Other') or 'Other'
        lang_count[lang] = lang_count.get(lang, 0) + 1
    
    sorted_langs = sorted(lang_count.items(), key=lambda x: x[1], reverse=True)
    report.append("📊 主流语言分布：")
    for lang, count in sorted_langs[:5]:
        report.append(f"   • {lang}: {count}个项目")
    report.append("")
    
    # Hot tracks
    all_tags = {}
    for repo in daily_repos + weekly_repos:
        name = repo.get('name', '')
        details = repo_details.get(name, {})
        insight = generate_insight(repo, details)
        for tag in insight['tags']:
            all_tags[tag] = all_tags.get(tag, 0) + 1
    
    sorted_tags = sorted(all_tags.items(), key=lambda x: x[1], reverse=True)
    report.append("🔥 热门赛道方向：")
    for tag, count in sorted_tags[:5]:
        report.append(f"   • {tag}: {count}个项目")
    report.append("")
    
    # Star projects recommendation
    report.append("⭐ 优质新星项目推荐：")
    
    # Find repos with highest stars today/this week
    top_daily = sorted(daily_repos, key=lambda x: int(x.get('total_stars', '0').replace(',', '')), reverse=True)[:3]
    for repo in top_daily:
        name = repo.get('name', '')
        details = repo_details.get(name, {})
        desc = (details.get('description', '') or '')[:60]
        report.append(f"   • {name}: {desc}...")
    
    report.append("")
    
    # Low quality warning
    report.append("⚠️ 低质项目避坑提示：")
    report.append("   • 无描述、无文档、低star的新项目谨慎使用")
    report.append("   • 注意检查项目是否活跃维护（最近更新时间）")
    report.append("   • 关注issue和PR的处理情况")
    
    report.append("")
    report.append("=" * 50)
    report.append("📝 报告由 Hermes Agent 自动生成")
    report.append("=" * 50)
    
    return '\n'.join(report)

# Generate and save
report = generate_report()
with open('/tmp/github_trending_report.txt', 'w', encoding='utf-8') as f:
    f.write(report)

print(report)
