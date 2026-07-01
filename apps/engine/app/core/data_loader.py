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

import baostock as bs
import numpy as np
import pandas as pd
import redis

# use absolute import or sys.path, actually relative import should work if we run from app/
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
try:
    from config import settings
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

    def get_main_board_stocks(self, date: Optional[str] = None) -> list:
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
            old_handler = signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
            signal.alarm(30)
            rs = bs.query_all_stock(day=date)
            while rs.next():
                code = rs.get_row_data()[0]
                if code.startswith(SH_PREFIX) or code.startswith(SZ_PREFIX):
                    stocks.append(code)
            signal.alarm(0)
            signal.signal(signal.SIGALRM, old_handler)
        except Exception as e:
            signal.alarm(0)
            print(f"[DataLoader] query_all_stock失败: {e}，使用备用范围")
            stocks = self._generate_stock_codes()

        if not stocks:
            prev = (datetime.strptime(date, '%Y-%m-%d') - timedelta(days=1)).strftime('%Y-%m-%d')
            return self.get_main_board_stocks(prev)

        self.r.setex(cache_key, 7 * 24 * 3600, json.dumps(stocks))
        print(f"[DataLoader] 获取到 {len(stocks)} 只股票")
        return stocks

    def _generate_stock_codes(self) -> list:
        codes = []
        for i in range(600000, 604000):
            codes.append(f"sh.{i:06d}")
        for i in range(605000, 606000):
            codes.append(f"sh.{i:06d}")
        for i in range(1, 4000):
            codes.append(f"sz.{i:06d}")
        return codes

    def load_kline_data(self, stocks: list, start_date: str, end_date: str,
                        fields: str = "date,code,open,high,low,close,volume,amount,turn,pctChg") -> pd.DataFrame:
        self.login()
        all_data = []
        total = len(stocks)

        for i, code in enumerate(stocks):
            if (i + 1) % 200 == 0:
                print(f"[DataLoader] 进度: {i+1}/{total}")
            try:
                rs = bs.query_history_k_data_plus(
                    code, fields,
                    start_date=start_date, end_date=end_date,
                    frequency="d", adjustflag="2"
                )
                while rs.next():
                    all_data.append(rs.get_row_data())
            except Exception as e:
                continue

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

