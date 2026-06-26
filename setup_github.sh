#!/bin/bash
# 用法: ./setup_github.sh <GitHub用户名> <Personal Access Token> [仓库名]
# 示例: ./setup_github.sh myuser ghp_xxxx stock-quant-system

set -e

GITHUB_USER=$1
GITHUB_TOKEN=$2
REPO_NAME=${3:-stock-quant-system}

if [ -z "$GITHUB_USER" ] || [ -z "$GITHUB_TOKEN" ]; then
    echo "用法: $0 <GitHub用户名> <Personal Access Token> [仓库名]"
    echo ""
    echo "获取 Token: https://github.com/settings/tokens"
    echo "  → Generate new token (classic)"
    echo "  → 勾选 repo 权限"
    exit 1
fi

echo "📦 创建私有仓库: $REPO_NAME ..."
curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/user/repos \
  -d "{\"name\":\"$REPO_NAME\",\"private\":true,\"description\":\"A股量化交易系统：数据采集 + 指标计算 + LLM分析 + Alpha因子挖掘\"}" \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print(f'✅ 仓库创建成功: {r.get(\"html_url\",\"(已存在)\")}')" 2>/dev/null || echo "⚠️ 仓库可能已存在，继续..."

cd "$(dirname "$0")"

echo "🔗 配置远程仓库..."
git remote remove origin 2>/dev/null || true
git remote add origin "https://$GITHUB_USER:$GITHUB_TOKEN@github.com/$GITHUB_USER/$REPO_NAME.git"

echo "📤 推送代码..."
git push -u origin master

echo ""
echo "✅ 完成！仓库地址: https://github.com/$GITHUB_USER/$REPO_NAME"
echo "⚠️ 建议立即更换 Token（已嵌入 remote URL）:"
echo "   git remote set-url origin https://github.com/$GITHUB_USER/$REPO_NAME.git"
