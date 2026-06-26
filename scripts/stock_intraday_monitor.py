#!/usr/bin/env python3
"""
股票盘中监控脚本
监控昨日报告中的重点关注和自选股，检查走势是否符合预测
"""

import json
import os
import sys
import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path

# 添加父目录到路径
SCRIPTS_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPTS_DIR))

def load_yesterday_report(date_str=None):
    """加载昨日选股报告数据"""
    output_dir = Path("/opt/data/profiles/quant-trading/cron/output")
    
    # 如果没有指定日期，找最新的stock_data.json
    if not date_str:
        # 查找最近的stock_output目录
        tmp_dir = Path("/tmp")
        stock_dirs = sorted(tmp_dir.glob("stock_output_20*"), key=lambda x: x.name, reverse=True)
        for d in stock_dirs:
            data_file = d / "stock_data.json"
            if data_file.exists() and data_file.stat().st_size > 1000:
                print(f"加载数据: {data_file}", file=sys.stderr)
                return load_from_stock_data(data_file)
    
    # 尝试从cron output加载
    data_file = output_dir / f"stock_data_{date_str}.json"
    if data_file.exists():
        return load_from_stock_data(data_file)
    
    return None

def load_from_stock_data(data_file):
    """从stock_data.json加载股票数据"""
    with open(data_file, 'r') as f:
        data = json.load(f)
    
    # 排除的股票代码
    EXCLUDE_CODES = {'600228', 'sh.600228'}
    
    result = {
        'date': data.get('date'),
        'stocks': {},
        'watchlist': {}
    }
    
    # 加载重点关注股票（评分>=4）
    for stock in data.get('stocks', []):
        code = stock.get('code')
        clean_code = code.split('.')[-1] if '.' in code else code
        if code and stock.get('quant_score', 0) >= 4 and clean_code not in EXCLUDE_CODES:
            result['stocks'][code] = extract_stock_info(stock)
    
    # 加载自选股
    for stock in data.get('watchlist_stocks', []):
        code = stock.get('code')
        clean_code = code.split('.')[-1] if '.' in code else code
        if code and clean_code not in EXCLUDE_CODES:
            result['watchlist'][code] = extract_stock_info(stock)
    
    return result

def extract_stock_info(stock):
    """提取股票关键信息"""
    strategy = stock.get('strategy', {})
    
    # 从signals中提取价位信息
    signals = stock.get('signals', [])
    
    return {
        'name': stock.get('name', '?'),
        'close': stock.get('close'),
        'pctChg_today': stock.get('pctChg_today'),
        'quant_score': stock.get('quant_score'),
        'strategy_type': strategy.get('type'),
        'entry': strategy.get('entry'),
        'stop_loss': strategy.get('stop_loss'),
        'exit': strategy.get('exit'),
        'boll_r2': stock.get('boll_r2'),
        'signals': signals,
        'alpha_boost': stock.get('alpha_boost'),
        'market_trend': stock.get('market_trend', {})
    }

def get_realtime_data(codes):
    """获取实时行情数据"""
    import akshare as ak
    import time
    
    results = {}
    for code in codes:
        try:
            # 转换股票代码格式: sh.600539 -> 600539
            ak_code = code.split('.')[-1] if '.' in code else code
            
            # 重试机制
            for attempt in range(3):
                try:
                    df = ak.stock_zh_a_hist(
                        symbol=ak_code, 
                        period='daily', 
                        adjust='qfq',
                        start_date=(datetime.now() - timedelta(days=5)).strftime('%Y%m%d')
                    )
                    if not df.empty:
                        latest = df.iloc[-1]
                        prev_close = df.iloc[-2]['收盘'] if len(df) > 1 else latest['开盘']
                        
                        results[code] = {
                            'date': str(latest['日期']),
                            'open': latest['开盘'],
                            'close': latest['收盘'],
                            'high': latest['最高'],
                            'low': latest['最低'],
                            'volume': latest['成交量'],
                            'amount': latest['成交额'],
                            'pctChg': latest['涨跌幅'],
                            'prev_close': prev_close
                        }
                    break  # 成功则跳出重试循环
                except Exception as e:
                    if attempt < 2:
                        time.sleep(1)  # 等待1秒后重试
                    else:
                        results[code] = {'error': str(e)}
        except Exception as e:
            results[code] = {'error': str(e)}
    
    return results

def analyze_prediction_vs_actual(prediction, realtime):
    """分析预测vs实际"""
    if 'error' in realtime:
        return {'status': 'error', 'message': realtime['error']}
    
    result = {
        'current_price': realtime['close'],
        'pctChg': realtime['pctChg'],
        'high': realtime['high'],
        'low': realtime['low'],
        'alerts': []
    }
    
    # 检查是否触及止损
    # TODO: 需要从prediction中解析具体价位
    
    # 检查是否触及目标
    
    # 检查是否符合策略预期
    strategy_type = prediction.get('strategy_type')
    boll_r2 = prediction.get('boll_r2', 0)
    
    if strategy_type == '趋势跟踪' and boll_r2 > 0.7:
        # 强趋势策略，看是否延续
        if realtime['pctChg'] > 0:
            result['trend_match'] = True
        else:
            result['trend_match'] = False
            result['alerts'].append('趋势策略但今日下跌')
    elif strategy_type == '均值回归':
        # 均值回归策略，看是否反弹
        pass
    
    return result

def generate_monitor_report(yesterday_data, realtime_data, current_time):
    """生成监控报告"""
    report = []
    report.append(f"# 盘中监控报告")
    report.append(f"")
    report.append(f"**监控时间**: {current_time}")
    report.append(f"**数据来源**: 昨日选股报告 ({yesterday_data.get('date', 'N/A')})")
    report.append(f"")
    
    # 自选股监控
    if yesterday_data.get('watchlist'):
        report.append(f"## 自选股监控")
        report.append(f"")
        report.append(f"| 代码 | 名称 | 昨收 | 现价 | 涨跌幅 | 今日最高 | 今日最低 | 策略 | 状态 |")
        report.append(f"|------|------|------|------|--------|----------|----------|------|------|")
        
        for code, pred in yesterday_data['watchlist'].items():
            rt = realtime_data.get(code, {})
            if 'error' in rt:
                status = '数据异常'
            else:
                status = check_status(pred, rt)
            
            close_str = f"{rt.get('close', 0):.2f}" if rt.get('close') else 'N/A'
            pct_str = f"{rt.get('pctChg', 0):.2f}" if rt.get('pctChg') is not None else 'N/A'
            high_str = f"{rt.get('high', 0):.2f}" if rt.get('high') else 'N/A'
            low_str = f"{rt.get('low', 0):.2f}" if rt.get('low') else 'N/A'
            pred_close = f"{pred['close']:.2f}" if pred.get('close') else 'N/A'
            report.append(f"| {code} | {pred['name']} | {pred_close} | {close_str} | {pct_str}% | {high_str} | {low_str} | {pred['strategy_type']} | {status} |")
        
        report.append(f"")
    
    # 重点关注股票
    if yesterday_data.get('stocks'):
        report.append(f"## 重点关注 (评分>=4)")
        report.append(f"")
        
        # 按评分排序
        sorted_stocks = sorted(
            yesterday_data['stocks'].items(), 
            key=lambda x: x[1].get('quant_score', 0), 
            reverse=True
        )
        
        # 只显示Top10
        top_stocks = sorted_stocks[:10]
        
        report.append(f"| 代码 | 名称 | 评分 | 昨收 | 现价 | 涨跌幅 | 今日最高 | 今日最低 | 策略 | 状态 |")
        report.append(f"|------|------|------|------|------|--------|----------|----------|------|------|")
        
        for code, pred in top_stocks:
            rt = realtime_data.get(code, {})
            if 'error' in rt:
                status = '数据异常'
            else:
                status = check_status(pred, rt)
            
            close_str = f"{rt.get('close', 0):.2f}" if rt.get('close') else 'N/A'
            pct_str = f"{rt.get('pctChg', 0):.2f}" if rt.get('pctChg') is not None else 'N/A'
            high_str = f"{rt.get('high', 0):.2f}" if rt.get('high') else 'N/A'
            low_str = f"{rt.get('low', 0):.2f}" if rt.get('low') else 'N/A'
            pred_close = f"{pred['close']:.2f}" if pred.get('close') else 'N/A'
            score_str = f"{pred['quant_score']:.1f}" if pred.get('quant_score') else 'N/A'
            report.append(f"| {code} | {pred['name']} | {score_str} | {pred_close} | {close_str} | {pct_str}% | {high_str} | {low_str} | {pred['strategy_type']} | {status} |")
        
        report.append(f"")
    
    # 异常提醒
    alerts = collect_alerts(yesterday_data, realtime_data)
    if alerts:
        report.append(f"## 异常提醒")
        report.append(f"")
        for alert in alerts:
            report.append(f"- {alert}")
        report.append(f"")
    
    # 市场概况
    report.append(f"## 市场概况")
    report.append(f"")
    
    # 统计涨跌
    all_stocks = {**yesterday_data.get('stocks', {}), **yesterday_data.get('watchlist', {})}
    up_count = sum(1 for code in all_stocks if realtime_data.get(code, {}).get('pctChg', 0) > 0)
    down_count = sum(1 for code in all_stocks if realtime_data.get(code, {}).get('pctChg', 0) < 0)
    flat_count = len(all_stocks) - up_count - down_count
    
    report.append(f"- 监控股票: {len(all_stocks)} 只")
    report.append(f"- 上涨: {up_count} 只")
    report.append(f"- 下跌: {down_count} 只")
    report.append(f"- 平盘: {flat_count} 只")
    report.append(f"")
    
    report.append(f"---")
    report.append(f"*注: 数据来自东方财富，仅供参考*")
    
    return '\n'.join(report)

def check_status(prediction, realtime):
    """检查股票状态"""
    pctChg = realtime.get('pctChg', 0)
    close = realtime.get('close', 0)
    
    # 简单状态判断
    if pctChg > 5:
        return '强势上涨'
    elif pctChg > 2:
        return '上涨'
    elif pctChg > 0:
        return '小幅上涨'
    elif pctChg > -2:
        return '小幅下跌'
    elif pctChg > -5:
        return '下跌'
    else:
        return '大幅下跌'

def collect_alerts(yesterday_data, realtime_data):
    """收集异常提醒"""
    alerts = []
    
    all_stocks = {**yesterday_data.get('stocks', {}), **yesterday_data.get('watchlist', {})}
    
    for code, pred in all_stocks.items():
        rt = realtime_data.get(code, {})
        if 'error' in rt:
            continue
        
        pctChg = rt.get('pctChg', 0)
        close = rt.get('close', 0)
        prev_close = pred.get('close', 0)
        
        # 大幅波动提醒
        if abs(pctChg) > 5:
            direction = '上涨' if pctChg > 0 else '下跌'
            alerts.append(f"**{code} {pred['name']}** {direction} {pctChg:.2f}%，注意风险")
        
        # 跌破止损提醒（需要解析具体价位）
        # TODO: 实现止损价位解析
        
        # 触及目标提醒
        # TODO: 实现目标价位解析
    
    return alerts

def main():
    parser = argparse.ArgumentParser(description='股票盘中监控')
    parser.add_argument('--date', type=str, help='昨日日期 YYYY-MM-DD')
    parser.add_argument('--output', type=str, help='输出报告路径')
    args = parser.parse_args()
    
    # 加载昨日数据
    yesterday_data = load_yesterday_report(args.date)
    if not yesterday_data:
        print("错误: 无法加载昨日报告数据", file=sys.stderr)
        sys.exit(1)
    
    # 获取所有需要监控的股票代码
    all_codes = list(yesterday_data.get('stocks', {}).keys()) + \
                list(yesterday_data.get('watchlist', {}).keys())
    all_codes = list(set(all_codes))  # 去重
    
    if not all_codes:
        print("没有需要监控的股票", file=sys.stderr)
        sys.exit(0)
    
    # 获取实时数据
    realtime_data = get_realtime_data(all_codes)
    
    # 生成报告 - 使用北京时间
    beijing_tz = timezone(timedelta(hours=8))
    current_time = datetime.now(beijing_tz).strftime('%Y-%m-%d %H:%M:%S')
    report = generate_monitor_report(yesterday_data, realtime_data, current_time)
    
    # 输出报告
    if args.output:
        with open(args.output, 'w') as f:
            f.write(report)
        print(f"REPORT_FILE={args.output}")
    else:
        print(report)

if __name__ == '__main__':
    main()
