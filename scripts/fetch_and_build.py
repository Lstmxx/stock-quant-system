#!/usr/bin/env python3
"""
从 ChatGPT cookies 批量获取 session 并生成 auth.json

用法:
  1. 在 cookies.txt 中放入每个账号的 cookie（每行一个账号，格式: name|cookie_string）
  2. 运行: python3 fetch_and_build.py cookies.txt [output_dir]

或者直接从浏览器导出 cookies（Netscape 格式），脚本会自动提取。
"""

import json
import sys
import os
import re
import time
import requests

CHATGPT_SESSION_URL = "https://chatgpt.com/api/auth/session"
# 备用: 如果主域名不通，可尝试的 URL
FALLBACK_URLS = [
    "https://chat.openai.com/api/auth/session",
]

def fetch_session(cookie_str: str, proxy: str = None) -> dict:
    """用 cookie 请求 ChatGPT session API"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Cookie': cookie_str,
    }
    proxies = {'http': proxy, 'https': proxy} if proxy else None

    for url in [CHATGPT_SESSION_URL] + FALLBACK_URLS:
        try:
            resp = requests.get(url, headers=headers, proxies=proxies, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                if 'accessToken' in data or 'access_token' in data:
                    return data
                print(f"  警告: 响应中无 accessToken，可能未登录")
                return data
            elif resp.status_code == 401:
                print(f"  未授权 (401)，cookie 可能已过期")
                return None
            else:
                print(f"  HTTP {resp.status_code}")
        except Exception as e:
            print(f"  请求失败: {e}")
    return None


def parse_cookies_file(filepath: str) -> list:
    """
    解析 cookies 文件，支持两种格式:

    格式1 (每行 name|cookie):
    账号1|__Secure-next-auth.session-token=eyxxx; ...
    账号2|__Secure-next-auth.session-token=eyyyy; ...

    格式2 (JSON):
    [{"name": "账号1", "cookie": "..."}, ...]
    """
    accounts = []

    with open(filepath, 'r') as f:
        content = f.read().strip()

    # 尝试 JSON 格式
    try:
        data = json.loads(content)
        if isinstance(data, list):
            return data
    except:
        pass

    # 管道分隔格式
    for line in content.split('\n'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if '|' in line:
            name, cookie = line.split('|', 1)
            accounts.append({'name': name.strip(), 'cookie': cookie.strip()})

    return accounts


def extract_session_fields(session: dict) -> dict:
    """从 session 提取关键字段，用于 accounts.json"""
    user = session.get('user', {}) if isinstance(session.get('user'), dict) else {}
    account = session.get('account', {}) if isinstance(session.get('account'), dict) else {}

    return {
        'access_token': session.get('accessToken', session.get('access_token', '')),
        'id_token': session.get('idToken', session.get('id_token', '')),
        'account_id': account.get('id', session.get('account_id', '')),
        'user_id': user.get('id', session.get('user_id', '')),
        'plan_type': account.get('planType', account.get('plan_type', '')),
        'name': user.get('name', ''),
        'email': user.get('email', ''),
        'expires': session.get('expires', ''),
    }


def main():
    if len(sys.argv) < 2:
        print("用法: python3 fetch_and_build.py cookies.txt [output_dir] [proxy]")
        print("\ncookies.txt 格式 (每行一个账号):")
        print('  账号名|__Secure-next-auth.session-token=eyxxx; other_cookie=value; ...')
        sys.exit(1)

    cookies_file = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else 'codex_auths'
    proxy = sys.argv[3] if len(sys.argv) > 3 else os.environ.get('HTTP_PROXY')

    accounts = parse_cookies_file(cookies_file)
    if not accounts:
        print("没有找到账号配置")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)
    success = 0
    failed = 0

    print(f"=== 批量获取 ChatGPT Session 并生成 auth.json ===")
    print(f"账号数: {len(accounts)}")
    print(f"输出目录: {output_dir}")
    print()

    for i, acc in enumerate(accounts, 1):
        name = acc.get('name', f'账号{i}')
        cookie = acc.get('cookie', '')
        print(f"[{i}/{len(accounts)}] {name}")

        if not cookie:
            print(f"  ⚠️  无 cookie，跳过")
            failed += 1
            continue

        session = fetch_session(cookie, proxy)
        if not session:
            print(f"  ❌ 获取 session 失败")
            failed += 1
            continue

        fields = extract_session_fields(session)
        if not fields['access_token']:
            print(f"  ❌ 未获取到 access_token")
            failed += 1
            continue

        # 保存到 accounts.json 供 batch_codex_auth.py 使用
        entry = {
            'name': name,
            'session': session,
        }

        # 直接调用 batch_codex_auth 的逻辑
        from batch_codex_auth import process_account
        result = process_account(entry)

        if result['error']:
            print(f"  ❌ {result['error']}")
            failed += 1
            continue

        safe_name = name.replace('/', '_').replace(' ', '_')
        account_dir = os.path.join(output_dir, safe_name)
        os.makedirs(account_dir, exist_ok=True)

        out_path = os.path.join(account_dir, 'auth.json')
        with open(out_path, 'w') as f:
            json.dump(result['auth_json'], f, indent=2, ensure_ascii=False)

        print(f"  ✅ 生成成功")
        print(f"     邮箱: {fields['email'] or '(未知)'}")
        print(f"     套餐: {fields['plan_type'] or '(未知)'}")
        print(f"     账号: {fields['account_id']}")
        print(f"     输出: {out_path}")
        success += 1

        # 避免请求过快
        if i < len(accounts):
            time.sleep(1)

    print()
    print(f"=== 完成: {success} 成功, {failed} 失败 ===")
    if success > 0:
        print(f"\n将 auth.json 放到 ~/.codex/ 即可跳过 Codex 登录验证:")
        print(f"  cp {output_dir}/<账号名>/auth.json ~/.codex/auth.json")


if __name__ == '__main__':
    main()
