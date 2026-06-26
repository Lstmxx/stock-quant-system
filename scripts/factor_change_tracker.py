#!/usr/bin/env python3
"""
Alpha因子变动追踪
================
对比今日与昨日的因子库快照，生成变动报告。

输出JSON格式：
{
  "date": "2026-05-29",
  "total_factors": 15,
  "valid_factors": 12,
  "changes": {
    "new": [...],      # 新增因子
    "removed": [...],  # 移除因子
    "improved": [...], # IC提升的因子
    "declined": [...], # IC下降的因子
    "ranking": [...]   # 排名变动
  },
  "top_factors": [...], # 当前Top因子
  "summary": "..."
}
"""
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

FACTOR_LIBRARY_PATH = '/opt/data/alpha_miner/factors/factor_library.json'
SNAPSHOT_DIR = '/opt/data/alpha_miner/factors/snapshots'


def load_factors():
    """加载当前因子库"""
    try:
        with open(FACTOR_LIBRARY_PATH) as f:
            data = json.load(f)
        return data.get('factors', [])
    except Exception as e:
        print(f"[!] 加载因子库失败: {e}", file=sys.stderr)
        return []


def load_snapshot(date_str):
    """加载指定日期的因子库快照"""
    path = os.path.join(SNAPSHOT_DIR, f'factor_library_{date_str}.json')
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            data = json.load(f)
        return data.get('factors', [])
    except Exception:
        return None


def save_snapshot(factors, date_str):
    """保存因子库快照"""
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    path = os.path.join(SNAPSHOT_DIR, f'factor_library_{date_str}.json')
    with open(path, 'w') as f:
        json.dump({'factors': factors, 'snapshot_date': date_str}, f, ensure_ascii=False, indent=2)
    return path


def get_valid_factors(factors, min_ic=0.02):
    """筛选有效因子（IC > 阈值）"""
    valid = []
    for f in factors:
        ic = f.get('ic_abs_weighted', 0)
        if ic > min_ic:
            valid.append(f)
    valid.sort(key=lambda x: -x.get('ic_abs_weighted', 0))
    return valid


def compare_factors(old_factors, new_factors):
    """对比两日因子库，生成变动报告"""
    old_map = {f['id']: f for f in old_factors}
    new_map = {f['id']: f for f in new_factors}
    
    old_ids = set(old_map.keys())
    new_ids = set(new_map.keys())
    
    # 新增因子
    new_ids_added = new_ids - old_ids
    new_list = []
    for fid in new_ids_added:
        f = new_map[fid]
        new_list.append({
            'id': fid,
            'name': f.get('name', ''),
            'expression': f.get('expression', ''),
            'ic': f.get('ic_abs_weighted', 0),
            'icir': f.get('icir', 0),
            'hypothesis': f.get('hypothesis', ''),
            'reason': '新发现因子'
        })
    
    # 移除因子
    removed_ids = old_ids - new_ids
    removed_list = []
    for fid in removed_ids:
        f = old_map[fid]
        removed_list.append({
            'id': fid,
            'name': f.get('name', ''),
            'expression': f.get('expression', ''),
            'ic': f.get('ic_abs_weighted', 0),
            'reason': '因子失效或被移除'
        })
    
    # IC变动
    improved = []
    declined = []
    common_ids = old_ids & new_ids
    for fid in common_ids:
        old = old_map[fid]
        new = new_map[fid]
        old_ic = old.get('ic_abs_weighted', 0)
        new_ic = new.get('ic_abs_weighted', 0)
        delta = new_ic - old_ic
        
        if abs(delta) > 0.001:  # 变动超过阈值
            entry = {
                'id': fid,
                'name': new.get('name', ''),
                'expression': new.get('expression', ''),
                'old_ic': old_ic,
                'new_ic': new_ic,
                'delta': delta,
                'old_icir': old.get('icir', 0),
                'new_icir': new.get('icir', 0),
                'hypothesis': new.get('hypothesis', ''),
                'notes': new.get('notes', '')
            }
            if delta > 0:
                improved.append(entry)
            else:
                declined.append(entry)
    
    improved.sort(key=lambda x: -x['delta'])
    declined.sort(key=lambda x: x['delta'])
    
    # 排名变动
    old_valid = get_valid_factors(old_factors)
    new_valid = get_valid_factors(new_factors)
    old_rank = {f['id']: i+1 for i, f in enumerate(old_valid)}
    new_rank = {f['id']: i+1 for i, f in enumerate(new_valid)}
    
    ranking_changes = []
    for fid in new_rank:
        old_r = old_rank.get(fid, len(old_valid) + 1)
        new_r = new_rank[fid]
        rank_delta = old_r - new_r  # 正数=排名上升
        if abs(rank_delta) >= 2:  # 排名变动>=2位
            f = new_map[fid]
            ranking_changes.append({
                'id': fid,
                'name': f.get('name', ''),
                'old_rank': old_r,
                'new_rank': new_r,
                'rank_delta': rank_delta,
                'ic': f.get('ic_abs_weighted', 0)
            })
    
    ranking_changes.sort(key=lambda x: -x['rank_delta'])
    
    return {
        'new': new_list,
        'removed': removed_list,
        'improved': improved,
        'declined': declined,
        'ranking': ranking_changes
    }


def generate_summary(changes, total, valid):
    """生成变动摘要文本"""
    parts = []
    n = len(changes['new'])
    if n:
        parts.append(f"新增{n}个因子")
    n = len(changes['removed'])
    if n:
        parts.append(f"移除{n}个因子")
    n = len(changes['improved'])
    if n:
        parts.append(f"{n}个因子IC提升")
    n = len(changes['declined'])
    if n:
        parts.append(f"{n}个因子IC下降")
    n = len(changes['ranking'])
    if n:
        parts.append(f"{n}个因子排名变动≥2位")
    
    if not parts:
        return f"因子库稳定，共{total}个因子（{valid}个有效），无显著变动。"
    return f"因子库变动：{'; '.join(parts)}。共{total}个因子（{valid}个有效）。"


def track_factor_changes():
    """主函数：追踪因子变动"""
    today = datetime.now().strftime('%Y-%m-%d')
    
    # 加载今日因子库
    factors = load_factors()
    if not factors:
        return None
    
    # 尝试加载昨日快照
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    # 尝试最近7天的快照
    old_factors = None
    old_date = None
    for i in range(1, 8):
        d = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')
        snapshot = load_snapshot(d)
        if snapshot:
            old_factors = snapshot
            old_date = d
            break
    
    # 对比
    if old_factors:
        changes = compare_factors(old_factors, factors)
        compare_note = f"对比 {old_date} vs {today}"
    else:
        # 无历史快照，只记录当前状态
        changes = {
            'new': [{'id': f['id'], 'name': f.get('name',''), 'expression': f.get('expression',''),
                      'ic': f.get('ic_abs_weighted',0), 'icir': f.get('icir',0),
                      'hypothesis': f.get('hypothesis',''), 'reason': '首次记录'}
                     for f in factors],
            'removed': [],
            'improved': [],
            'declined': [],
            'ranking': []
        }
        compare_note = f"首次记录（无历史快照）"
    
    valid_factors = get_valid_factors(factors)
    summary = generate_summary(changes, len(factors), len(valid_factors))
    
    # Top因子
    top_factors = []
    for i, f in enumerate(valid_factors[:10], 1):
        top_factors.append({
            'rank': i,
            'id': f['id'],
            'name': f.get('name', ''),
            'expression': f.get('expression', ''),
            'ic': f.get('ic_abs_weighted', 0),
            'icir': f.get('icir', 0),
            'direction': f.get('direction', 1),
            'hypothesis': f.get('hypothesis', '')
        })
    
    result = {
        'date': today,
        'compare_note': compare_note,
        'total_factors': len(factors),
        'valid_factors': len(valid_factors),
        'changes': changes,
        'top_factors': top_factors,
        'summary': summary
    }
    
    # 保存今日快照
    save_snapshot(factors, today)
    print(f"[OK] 因子变动追踪完成: {summary}", file=sys.stderr)
    
    return result


if __name__ == '__main__':
    result = track_factor_changes()
    if result:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print('{"error": "因子库加载失败"}')
        sys.exit(1)
