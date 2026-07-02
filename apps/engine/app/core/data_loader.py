"""
数据加载模块 (Redis Cache)
============
从baostock获取沪深主板股票的OHLCV数据，转换为因子计算所需的DataFrame格式。
支持 Redis 缓存：首次加载拉取数据，后续秒级加载。
"""
import signal
import sys
import time
import warnings
import json
import pickle
from datetime import datetime, timedelta
from typing import Dict, Optional

def _fetch_stock_chunk(args):
    codes, start_date, end_date, fields, redis_url = args
    import baostock as bs
    import redis
    import json
    
    r = redis.Redis.from_url(redis_url)
    bs.login()
    all_data = []
    
    def handler(signum, frame):
        raise TimeoutError("Baostock API timeout")
        
    signal.signal(signal.SIGALRM, handler)
    
    for i, code in enumerate(codes):
        if i % 20 == 0:
            print(f"[Worker] 正在拉取 {code} ({i}/{len(codes)})...", flush=True)
            
        retries = 0
        stock_data = []
        success = False
        while retries < 3:
            try:
                signal.alarm(10)  # 10秒超时
                rs = bs.query_history_k_data_plus(
                    code, fields,
                    start_date=start_date, end_date=end_date,
                    frequency="d", adjustflag="2"
                )
                while rs.next():
                    stock_data.append(rs.get_row_data())
                signal.alarm(0)  # 成功则取消超时
                success = True
                break
            except TimeoutError:
                print(f"[Worker] {code} 拉取超时，正在进行第 {retries + 1} 次重试...", flush=True)
                retries += 1
            except Exception as e:
                print(f"[Worker] {code} 拉取发生异常: {e}", flush=True)
                signal.alarm(0)
                break
                
        if success:
            key = f"kline:{code}:{start_date}_{end_date}"
            r.setex(key, 7 * 24 * 3600, json.dumps(stock_data))
            all_data.extend(stock_data)
        elif retries == 3:
            print(f"[Worker] {code} 连续 3 次拉取超时，已跳过！", flush=True)
            
    bs.logout()
    return all_data

import baostock as bs
import numpy as np
import pandas as pd
import redis

# use absolute import or sys.path, actually relative import should work if we run from app/
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
try:
    from .config import settings
    REDIS_URL = settings.redis_url
except ImportError:
    REDIS_URL = "redis://localhost:6379"

warnings.filterwarnings("ignore")

SH_PREFIX = "sh."
SZ_PREFIX = "sz."
LOOKBACK_DAYS = 250
CACHE_MAX_AGE_HOURS = 20

def get_redis():
    return redis.Redis.from_url(REDIS_URL)

class DataLoader:
    """从baostock加载A股数据，支持Redis缓存"""

    def __init__(self):
        self._logged_in = False
        self.r = get_redis()

    def login(self):
        if not self._logged_in:
            old_stdout = sys.stdout
            sys.stdout = sys.stderr
            result = bs.login()
            sys.stdout = old_stdout
            self._logged_in = True
            if result.error_code != '0':
                raise ConnectionError(f"baostock登录失败: {result.error_msg}")

    def logout(self):
        if self._logged_in:
            old_stdout = sys.stdout
            sys.stdout = sys.stderr
            bs.logout()
            sys.stdout = old_stdout
            self._logged_in = False

    def get_main_board_stocks(self, date: Optional[str] = None, depth: int = 0) -> list:
        if depth > 30:
            raise ValueError(f"已达到最大递归深度 (30)，无法获取有效的股票列表。最后尝试的日期为: {date}")
        
        self.login()
        if date is None:
            date = datetime.now().strftime('%Y-%m-%d')

        cache_key = "stock_list_cache"
        cached = self.r.get(cache_key)
        if cached:
            print(f"[DataLoader] Redis缓存股票列表")
            return json.loads(cached)

        stocks = []
        try:
            print(f"[DataLoader] 正在查询 {date} 的股票列表...", flush=True)
            rs = bs.query_all_stock(day=date)
            # Cannot use rs.get_data() because baostock uses deprecated pandas .append() internally
            while rs.next():
                row = rs.get_row_data()
                if not row or len(row) < 2:
                    continue
                code, tradeStatus = row[0], row[1]
                # Filter for normal trading status (1)
                if tradeStatus != '1':
                    continue
                # Filter for Main Board prefixes
                if code.startswith('sh.60') or code.startswith('sz.00'):
                    stocks.append(code)
        except Exception as e:
            print(f"[DataLoader] query_all_stock失败: {e}")
            stocks = []

        if not stocks:
            prev = (datetime.strptime(date, '%Y-%m-%d') - timedelta(days=1)).strftime('%Y-%m-%d')
            return self.get_main_board_stocks(prev, depth + 1)

        self.r.setex(cache_key, 7 * 24 * 3600, json.dumps(stocks))
        print(f"[DataLoader] 获取到 {len(stocks)} 只主板活跃股票")
        return stocks

    def load_kline_data(self, stocks: list, start_date: str, end_date: str,
                        fields: str = "date,code,open,high,low,close,volume,amount,turn,pctChg") -> pd.DataFrame:
        keys = [f"kline:{code}:{start_date}_{end_date}" for code in stocks]
        cached_values = self.r.mget(keys)
        
        missing_stocks = []
        all_data = []
        
        for code, cached_val in zip(stocks, cached_values):
            if cached_val is not None:
                all_data.extend(json.loads(cached_val))
            else:
                missing_stocks.append(code)
                
        print(f"[DataLoader] Redis单股缓存命中 {len(stocks) - len(missing_stocks)} 只，还需要拉取 {len(missing_stocks)} 只")

        if missing_stocks:
            total = len(missing_stocks)
            chunk_size = max(1, total // 10)  # max 10 workers
            chunks = [missing_stocks[i:i + chunk_size] for i in range(0, total, chunk_size)]
            
            args_list = [(chunk, start_date, end_date, fields, REDIS_URL) for chunk in chunks]
            
            from concurrent.futures import ProcessPoolExecutor
            print(f"[DataLoader] 开始多进程拉取缺失数据，共 {total} 只股票，分 {len(chunks)} 批次")
            with ProcessPoolExecutor(max_workers=10) as pool:
                for result in pool.map(_fetch_stock_chunk, args_list):
                    all_data.extend(result)

        if not all_data:
            raise ValueError("未获取到K线数据")

        df = pd.DataFrame(all_data, columns=fields.split(","))
        for col in ["open", "high", "low", "close", "volume", "amount", "turn", "pctChg"]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce')
        df = df.dropna(subset=["close"])
        df = df[df["close"] > 0]
        return df

    def pivot_data(self, df: pd.DataFrame) -> Dict[str, pd.DataFrame]:
        df['date'] = pd.to_datetime(df['date'])
        df = df.sort_values(['date', 'code'])
        result = {}
        for field in ['open', 'high', 'low', 'close', 'volume', 'amount', 'turn', 'pctChg']:
            if field in df.columns:
                pivot = df.pivot(index='date', columns='code', values=field)
                pivot = pivot.dropna(how='all').dropna(axis=1, how='all')
                result[field] = pivot
        return result

    def _save_cache(self, date_key: str, data: Dict[str, pd.DataFrame]):
        """保存到Redis"""
        pickled_data = pickle.dumps(data)
        self.r.setex(f"market_data:{date_key}", CACHE_MAX_AGE_HOURS * 3600, pickled_data)
        print(f"[DataLoader] 已缓存到 Redis market_data:{date_key}")

    def _load_cache(self, date_key: str) -> Optional[Dict[str, pd.DataFrame]]:
        """从Redis加载"""
        pickled_data = self.r.get(f"market_data:{date_key}")
        if pickled_data:
            print(f"[DataLoader] Redis缓存命中: market_data:{date_key}")
            return pickle.loads(pickled_data)
        return None

    def load_industry_data(self) -> pd.Series:
        self.login()
        cache_key = "industry_data_cache"
        cached = self.r.get(cache_key)
        if cached:
            print("[DataLoader] Redis缓存行业数据命中", flush=True)
            return pd.Series(json.loads(cached))
            
        print("[DataLoader] 正在查询全市场行业分类...", flush=True)
        rs = bs.query_stock_industry()
        industries = {}
        while rs.next():
            row = rs.get_row_data()
            if not row or len(row) < 4:
                continue
            code, industry = row[1], row[3]
            if code.startswith('sh.60') or code.startswith('sz.00'):
                industries[code] = industry if industry else 'Unknown'
                
        self.r.setex(cache_key, 7 * 24 * 3600, json.dumps(industries))
        return pd.Series(industries)

    def load_latest(self, lookback_days: int = LOOKBACK_DAYS,
                    end_date: Optional[str] = None) -> Dict[str, pd.DataFrame]:
        if end_date is None:
            end_date = datetime.now().strftime('%Y-%m-%d')
            
        date_key = f"{end_date}_{lookback_days}"
        
        # 1. 尝试Redis缓存
        cached = self._load_cache(date_key)
        if cached is not None:
            self.logout()
            return cached

        # 2. 从baostock加载
        start_dt = datetime.strptime(end_date, '%Y-%m-%d') - timedelta(days=lookback_days + 60)
        start_date = start_dt.strftime('%Y-%m-%d')

        print(f"[DataLoader] 加载数据: {start_date} ~ {end_date}")
        stocks = self.get_main_board_stocks(end_date)
        if not stocks:
            raise ValueError("未获取到股票列表")

        df = self.load_kline_data(stocks, start_date, end_date)
        data = self.pivot_data(df)
        
        # 加载并广播行业数据
        industry_series = self.load_industry_data()
        close_df = data['close']
        ind_aligned = industry_series.reindex(close_df.columns).fillna('Unknown')
        industry_df = pd.DataFrame([ind_aligned] * len(close_df.index), index=close_df.index, columns=close_df.columns)
        data['industry'] = industry_df

        # 3. 缓存
        self._save_cache(date_key, data)
        return data

    def preload(self, lookback_days: int = LOOKBACK_DAYS):
        """预加载并缓存数据"""
        print("[DataLoader] 开始预加载...")
        data = self.load_latest(lookback_days)
        self.logout()
        print("[DataLoader] 预加载完成")
        return data

_loader = DataLoader()

def load_market_data(lookback_days: int = LOOKBACK_DAYS,
                     end_date: Optional[str] = None) -> Dict[str, pd.DataFrame]:
    try:
        return _loader.load_latest(lookback_days, end_date)
    finally:
        _loader.logout()

def preload_market_data(lookback_days: int = LOOKBACK_DAYS):
    return _loader.preload(lookback_days)

