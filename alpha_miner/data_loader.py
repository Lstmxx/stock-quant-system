"""
数据加载模块
============
从baostock获取沪深主板股票的OHLCV数据，转换为因子计算所需的DataFrame格式。
支持HDF5缓存：首次加载~10分钟，后续秒级加载。

数据格式：行=日期，列=股票代码，值=相应指标
"""
import signal
import sys
import time
import warnings
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Optional

import baostock as bs
import numpy as np
import pandas as pd

from config import SH_PREFIX, SZ_PREFIX, LOOKBACK_DAYS, FACTORS_DIR

warnings.filterwarnings("ignore")

# HDF5缓存路径
HDF5_CACHE = FACTORS_DIR / "market_data.h5"
CACHE_MAX_AGE_HOURS = 20  # 缓存有效期（小时）


class DataLoader:
    """从baostock加载A股数据，支持HDF5缓存"""

    def __init__(self):
        self._logged_in = False

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

    # ─── 股票列表 ───

    def get_main_board_stocks(self, date: Optional[str] = None) -> list:
        self.login()
        if date is None:
            date = datetime.now().strftime('%Y-%m-%d')

        # 优先用缓存
        cache_file = FACTORS_DIR / "stock_list_cache.txt"
        if cache_file.exists():
            age = time.time() - cache_file.stat().st_mtime
            if age < 7 * 24 * 3600:
                stocks = [l.strip() for l in cache_file.open() if l.strip()]
                if stocks:
                    print(f"[DataLoader] 缓存股票列表: {len(stocks)}只")
                    return stocks

        # 带超时的query_all_stock
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

        try:
            cache_file.write_text('\n'.join(stocks) + '\n')
        except Exception as e:
            print(f"[DataLoader] 缓存股票列表失败: {e}")

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

    # ─── K线数据 ───

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
                print(f"[DataLoader] {code} 获取失败: {e}", flush=True)
                continue

        if not all_data:
            raise ValueError("未获取到K线数据")

        df = pd.DataFrame(all_data, columns=fields.split(","))
        for col in ["open", "high", "low", "close", "volume", "amount", "turn", "pctChg"]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce')
        df = df.dropna(subset=["close"])
        df = df[df["close"] > 0]
        print(f"[DataLoader] 获取到 {len(df)} 条K线")
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
        if result:
            s = list(result.values())[0]
            print(f"[DataLoader] Pivot: {s.shape[0]}天 x {s.shape[1]}只")
        return result

    # ─── HDF5缓存 ───

    def _save_cache(self, data: Dict[str, pd.DataFrame]):
        """保存到HDF5"""
        HDF5_CACHE.parent.mkdir(parents=True, exist_ok=True)
        with pd.HDFStore(str(HDF5_CACHE), mode='w', complevel=5) as store:
            for field, df in data.items():
                store[field] = df
            store['_meta'] = pd.DataFrame({
                'saved_at': [datetime.now().isoformat()],
                'fields': [','.join(data.keys())],
                'shape_0': [list(data.values())[0].shape[0]],
                'shape_1': [list(data.values())[0].shape[1]],
            })
        print(f"[DataLoader] 已缓存到 {HDF5_CACHE}")

    def _load_cache(self) -> Optional[Dict[str, pd.DataFrame]]:
        """从HDF5加载"""
        if not HDF5_CACHE.exists():
            return None
        age_hours = (time.time() - HDF5_CACHE.stat().st_mtime) / 3600
        if age_hours > CACHE_MAX_AGE_HOURS:
            print(f"[DataLoader] 缓存过期 ({age_hours:.1f}h > {CACHE_MAX_AGE_HOURS}h)")
            return None
        try:
            data = {}
            with pd.HDFStore(str(HDF5_CACHE), mode='r') as store:
                for field in ['open', 'high', 'low', 'close', 'volume', 'amount', 'turn', 'pctChg']:
                    if field in store:
                        data[field] = store[field]
            if data:
                s = list(data.values())[0]
                print(f"[DataLoader] HDF5缓存命中: {s.shape[0]}天 x {s.shape[1]}只 ({age_hours:.1f}h前)")
                return data
        except Exception as e:
            print(f"[DataLoader] HDF5读取失败: {e}")
        return None

    # ─── 主入口 ───

    def load_latest(self, lookback_days: int = LOOKBACK_DAYS,
                    end_date: Optional[str] = None) -> Dict[str, pd.DataFrame]:
        # 1. 尝试HDF5缓存
        cached = self._load_cache()
        if cached is not None:
            self.logout()
            return cached

        # 2. 从baostock加载
        if end_date is None:
            end_date = datetime.now().strftime('%Y-%m-%d')
        start_dt = datetime.strptime(end_date, '%Y-%m-%d') - timedelta(days=lookback_days + 60)
        start_date = start_dt.strftime('%Y-%m-%d')

        print(f"[DataLoader] 加载数据: {start_date} ~ {end_date}")
        stocks = self.get_main_board_stocks(end_date)
        if not stocks:
            raise ValueError("未获取到股票列表")

        df = self.load_kline_data(stocks, start_date, end_date)
        data = self.pivot_data(df)

        # 3. 缓存
        self._save_cache(data)
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
    """加载市场数据（优先HDF5缓存）"""
    try:
        return _loader.load_latest(lookback_days, end_date)
    finally:
        _loader.logout()


def preload_market_data(lookback_days: int = LOOKBACK_DAYS):
    """预加载数据到HDF5缓存"""
    return _loader.preload(lookback_days)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--preload", action="store_true", help="预加载并缓存数据")
    parser.add_argument("--lookback", type=int, default=250, help="回看天数")
    args = parser.parse_args()

    if args.preload:
        preload_market_data(args.lookback)
    else:
        data = load_market_data(args.lookback)
        for k, v in data.items():
            print(f"  {k}: {v.shape}")
