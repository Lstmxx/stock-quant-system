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
    worker_id, codes, start_date, end_date, fields, redis_url, task_id = args
    import baostock as bs
    import redis
    import json
    
    r = redis.Redis.from_url(redis_url)
    
    class BaostockTimeout(BaseException):
        pass

    def handler(signum, frame):
        raise BaostockTimeout("Baostock API timeout")
        
    signal.signal(signal.SIGALRM, handler)

    import random
    import time
    
    # Stagger logins to avoid overloading Baostock server
    time.sleep(random.uniform(0.5, 3.0))
    
    login_success = False
    for _ in range(3):
        try:
            signal.alarm(10)
            res = bs.login()
            signal.alarm(0)
            if res.error_code == '0':
                login_success = True
                break
        except BaostockTimeout:
            pass
        except Exception:
            signal.alarm(0)
        time.sleep(1)
        
    if not login_success:
        print(f"[Worker {worker_id}] bs.login error after 3 retries", flush=True)
        if task_id:
            # Record all codes in this chunk as failed (retryable: login failure)
            r.sadd(f"task_failed_stocks:{task_id}", *codes)
            r.expire(f"task_failed_stocks:{task_id}", 7 * 24 * 3600)
            r.hset(
                f"task_failed_stock_errors:{task_id}",
                mapping={code: "Baostock 登录失败" for code in codes},
            )
            r.expire(f"task_failed_stock_errors:{task_id}", 7 * 24 * 3600)
            state = json.dumps({
                "worker_id": worker_id, "total": len(codes),
                "success": 0, "failed": len(codes), "status": "failed"
            })
            r.hset(f"task_progress:{task_id}", str(worker_id), state)
            r.expire(f"task_progress:{task_id}", 7200)
        return []
        
    all_data = []
    
    total = len(codes)
    success_count = 0
    failed_count = 0
    cancelled_requested = False
    
    for i, code in enumerate(codes):
        if task_id:
            # Check for cancellation
            cancellation_flag = r.get(f"task_cancelled:{task_id}")
            if cancellation_flag:
                print(f"[Worker] Task {task_id} cancelled, stopping chunk fetch.", flush=True)
                cancelled_requested = True
                break
                
            r.publish(f"task_log:{task_id}", json.dumps({
                "type": "progress",
                "worker_id": worker_id,
                "total": total,
                "success": success_count,
                "failed": failed_count,
                "code": code,
                "status": "running"
            }))
            # Also write to hash for polling
            r.hset(f"task_progress:{task_id}", str(worker_id), json.dumps({
                "worker_id": worker_id, "total": total,
                "success": success_count, "failed": failed_count,
                "current_code": code, "status": "running"
            }))
            r.expire(f"task_progress:{task_id}", 7200)
                
        if i % 20 == 0:
            print(f"[Worker] 正在拉取 {code} ({i}/{len(codes)})...", flush=True)
            
        retries = 0
        stock_data = []
        success = False
        last_error = "未知错误"
        while retries < 3:
            try:
                signal.alarm(10)  # 10秒超时
                rs = bs.query_history_k_data_plus(
                    code, fields,
                    start_date=start_date, end_date=end_date,
                    frequency="d", adjustflag="2"
                )
                if rs.error_code != '0':
                    print(f"[Worker] {code} error {rs.error_code}: {rs.error_msg}", flush=True)
                    raise Exception(rs.error_msg)
                    
                while rs.next():
                    stock_data.append(rs.get_row_data())
                signal.alarm(0)  # 成功则取消超时
                if not stock_data:
                    raise ValueError("数据源未返回有效 K 线")
                success = True
                break
            except BaostockTimeout:
                print(f"[Worker] {code} 拉取超时，正在进行第 {retries + 1} 次重试...", flush=True)
                last_error = "Baostock 请求超时"
                retries += 1
            except Exception as e:
                print(f"[Worker] {code} 拉取发生异常: {e}", flush=True)
                signal.alarm(0)
                last_error = str(e) or e.__class__.__name__
                retries += 1
                time.sleep(1)
                
        if success:
            key = f"kline:{code}:{start_date}_{end_date}"
            r.set(key, json.dumps(stock_data), ex=7 * 24 * 3600)
            all_data.extend(stock_data)
            success_count += 1
            if task_id:
                r.publish(f"task_log:{task_id}", json.dumps({
                    "type": "progress", "worker_id": worker_id, "total": total,
                    "success": success_count, "failed": failed_count, "code": code, "status": "success"
                }))
                r.hset(f"task_progress:{task_id}", str(worker_id), json.dumps({
                    "worker_id": worker_id, "total": total,
                    "success": success_count, "failed": failed_count,
                    "current_code": code, "status": "running"
                }))
                r.expire(f"task_progress:{task_id}", 7200)
        else:
            print(f"[Worker] {code} 连续 3 次拉取失败，已跳过！", flush=True)
            failed_count += 1
            if task_id:
                r.sadd(f"task_failed_stocks:{task_id}", code)
                r.expire(f"task_failed_stocks:{task_id}", 7 * 24 * 3600)
                r.hset(f"task_failed_stock_errors:{task_id}", code, last_error)
                r.expire(f"task_failed_stock_errors:{task_id}", 7 * 24 * 3600)
                r.publish(f"task_log:{task_id}", json.dumps({
                    "type": "progress", "worker_id": worker_id, "total": total,
                    "success": success_count, "failed": failed_count, "code": code,
                    "status": "failed", "reason": last_error
                }))

    if task_id:
        if cancelled_requested:
            final_status = "cancelled"
        elif failed_count > 0:
            final_status = "failed" if success_count == 0 else "partial"
        else:
            final_status = "completed"
        r.hset(f"task_progress:{task_id}", str(worker_id), json.dumps({
            "worker_id": worker_id,
            "total": total,
            "success": success_count,
            "failed": failed_count,
            "current_code": None,
            "status": final_status,
        }))
        r.expire(f"task_progress:{task_id}", 7200)

    # Do NOT call bs.logout() here!
    # baostock uses a server-side session shared by IP. Calling logout() from any
    # worker process will invalidate the session for ALL concurrent workers on
    # the same machine. The subprocess socket is cleaned up automatically on exit.
    return all_data

import baostock as bs
import numpy as np
import pandas as pd
import redis
from ..config import settings

import os

REDIS_URL = settings.redis_url

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
        names = {}  # code -> code_name
        try:
            print(f"[DataLoader] 正在查询 {date} 的股票列表...", flush=True)
            rs = bs.query_all_stock(day=date)
            # Cannot use rs.get_data() because baostock uses deprecated pandas .append() internally
            while rs.next():
                row = rs.get_row_data()
                if not row or len(row) < 2:
                    continue
                code = row[0]
                tradeStatus = row[1]
                code_name = row[2] if len(row) > 2 else ''
                # Filter for normal trading status (1)
                if tradeStatus != '1':
                    continue
                # Filter for Main Board prefixes
                if code.startswith('sh.60') or code.startswith('sz.00'):
                    stocks.append(code)
                    if code_name:
                        names[code] = code_name
        except Exception as e:
            print(f"[DataLoader] query_all_stock失败: {e}")
            stocks = []

        if not stocks:
            prev = (datetime.strptime(date, '%Y-%m-%d') - timedelta(days=1)).strftime('%Y-%m-%d')
            return self.get_main_board_stocks(prev, depth + 1)

        self.r.set(cache_key, json.dumps(stocks), ex=7 * 24 * 3600)
        # Persist stock names into a Redis Hash (no TTL — names rarely change)
        if names:
            self.r.hset("stock_names", mapping=names)
        print(f"[DataLoader] 获取到 {len(stocks)} 只主板活跃股票（已保存 {len(names)} 个股票名称）")
        return stocks

    def load_stock_names(self) -> dict:
        """从 Redis Hash 读取 code->name 映射，若不存在则触发一次全量查询"""
        raw = self.r.hgetall("stock_names")
        if raw:
            return {k.decode() if isinstance(k, bytes) else k:
                    v.decode() if isinstance(v, bytes) else v
                    for k, v in raw.items()}
        # Trigger a fresh fetch which will populate stock_names as side effect
        self.get_main_board_stocks()
        raw = self.r.hgetall("stock_names")
        return {k.decode() if isinstance(k, bytes) else k:
                v.decode() if isinstance(v, bytes) else v
                for k, v in raw.items()}

    def load_kline_data(self, stocks: list, start_date: str, end_date: str,
                        fields: str = "date,code,open,high,low,close,volume,amount,turn,pctChg",
                        task_id: Optional[str] = None, force_update: bool = False,
                        worker_count: int = 4,
                        allow_fetch_missing: bool = True) -> pd.DataFrame:
        keys = [f"kline:{code}:{start_date}_{end_date}" for code in stocks]
        cached_values = [None] * len(stocks) if force_update else self.r.mget(keys)
        
        missing_stocks = []
        all_data = []
        
        for code, cached_val in zip(stocks, cached_values):
            if cached_val is not None:
                all_data.extend(json.loads(cached_val))
            else:
                missing_stocks.append(code)
                
        print(f"[DataLoader] Redis单股缓存命中 {len(stocks) - len(missing_stocks)} 只，还需要拉取 {len(missing_stocks)} 只")

        if missing_stocks and allow_fetch_missing:
            total = len(missing_stocks)
            chunk_size = max(1, total // worker_count)
            chunks = [missing_stocks[i:i + chunk_size] for i in range(0, total, chunk_size)]
            
            if task_id:
                for i, chunk in enumerate(chunks):
                    self.r.publish(f"task_log:{task_id}", json.dumps({
                        "type": "init",
                        "worker_id": i + 1,
                        "total": len(chunk)
                    }))
            
            args_list = [(i + 1, chunk, start_date, end_date, fields, REDIS_URL, task_id) for i, chunk in enumerate(chunks)]
            
            from concurrent.futures import ProcessPoolExecutor
            print(f"[DataLoader] 开始多进程拉取缺失数据，共 {total} 只股票，分 {len(chunks)} 批次 (worker_count={worker_count})")
            with ProcessPoolExecutor(max_workers=worker_count) as pool:
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

    @staticmethod
    def _date_range(lookback_days: int, end_date: Optional[str] = None) -> tuple[str, str, str]:
        resolved_end_date = end_date or datetime.now().strftime("%Y-%m-%d")
        start_dt = datetime.strptime(resolved_end_date, "%Y-%m-%d") - timedelta(
            days=lookback_days + 60
        )
        start_date = start_dt.strftime("%Y-%m-%d")
        date_key = f"{resolved_end_date}_{lookback_days}"
        return start_date, resolved_end_date, date_key

    def _build_market_data(self, df: pd.DataFrame) -> Dict[str, pd.DataFrame]:
        data = self.pivot_data(df)
        close_df = data.get("close")
        if close_df is None or close_df.empty:
            raise ValueError("未获取到有效收盘价数据")

        industry_series = self.load_industry_data()
        industry_aligned = industry_series.reindex(close_df.columns).fillna("Unknown")
        data["industry"] = pd.DataFrame(
            [industry_aligned] * len(close_df.index),
            index=close_df.index,
            columns=close_df.columns,
        )

        names_series = pd.Series(self.load_stock_names())
        data["stock_names"] = names_series.reindex(close_df.columns).fillna("")
        return data

    def _reset_task_failures(self, task_id: Optional[str]) -> None:
        if not task_id:
            return
        self.r.delete(
            f"task_failed_stocks:{task_id}",
            f"task_failed_stock_errors:{task_id}",
            f"task_progress:{task_id}",
        )

    def _record_missing_stocks(self, task_id: Optional[str], stocks: list[str],
                               available: set[str]) -> None:
        if not task_id:
            return
        already_failed = {
            code.decode() if isinstance(code, bytes) else code
            for code in self.r.smembers(f"task_failed_stocks:{task_id}")
        }
        missing = [code for code in stocks if code not in available and code not in already_failed]
        if not missing:
            return
        self.r.sadd(f"task_failed_stocks:{task_id}", *missing)
        self.r.hset(
            f"task_failed_stock_errors:{task_id}",
            mapping={code: "未生成有效收盘价数据" for code in missing},
        )
        self.r.expire(f"task_failed_stocks:{task_id}", 7 * 24 * 3600)
        self.r.expire(f"task_failed_stock_errors:{task_id}", 7 * 24 * 3600)

    def _save_cache(self, date_key: str, data: Dict[str, pd.DataFrame]):
        """通过临时 key 原子替换聚合行情缓存。"""
        pickled_data = pickle.dumps(data)
        cache_key = f"market_data:{date_key}"
        temporary_key = f"{cache_key}:tmp:{os.getpid()}:{time.time_ns()}"
        pipeline = self.r.pipeline()
        pipeline.set(
            temporary_key,
            pickled_data,
            ex=CACHE_MAX_AGE_HOURS * 3600,
        )
        pipeline.rename(temporary_key, cache_key)
        pipeline.execute()
        print(f"[DataLoader] 已原子更新 Redis {cache_key}")

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
                
        self.r.set(cache_key, json.dumps(industries), ex=7 * 24 * 3600)
        return pd.Series(industries)

    def load_latest(self, lookback_days: int = LOOKBACK_DAYS,
                    end_date: Optional[str] = None,
                    task_id: Optional[str] = None,
                    force_update: bool = False,
                    worker_count: int = 4) -> Dict[str, pd.DataFrame]:
        self.login()
        start_date, end_date, date_key = self._date_range(lookback_days, end_date)
        
        # 1. 尝试Redis缓存
        if not force_update:
            cached = self._load_cache(date_key)
            if cached is not None:
                self.logout()
                return cached

        # 2. 从baostock加载
        print(f"[DataLoader] 加载数据: {start_date} ~ {end_date} (worker_count={worker_count})")
        stocks = self.get_main_board_stocks(end_date)
        if not stocks:
            raise ValueError("未获取到股票列表")

        df = self.load_kline_data(stocks, start_date, end_date, task_id=task_id, force_update=force_update, worker_count=worker_count)
        data = self._build_market_data(df)
        self._record_missing_stocks(task_id, stocks, set(data["close"].columns))

        # 3. 缓存
        self._save_cache(date_key, data)
        return data

    def collect_latest(self, lookback_days: int, task_id: str,
                       force_update: bool, worker_count: int) -> tuple[Dict[str, pd.DataFrame], dict]:
        self._reset_task_failures(task_id)
        try:
            data = self.load_latest(
                lookback_days=lookback_days,
                task_id=task_id,
                force_update=force_update,
                worker_count=worker_count,
            )
            failed_codes = set(self.r.smembers(f"task_failed_stocks:{task_id}"))
            failed = {
                code.decode() if isinstance(code, bytes) else code
                for code in failed_codes
            }
            success_count = len(data.get("close", pd.DataFrame()).columns)
            return data, {
                "totalCount": success_count + len(failed),
                "successCount": success_count,
                "failedCount": len(failed),
            }
        finally:
            self.logout()

    def retry_failed_stocks(self, stocks: list[str], lookback_days: int,
                            task_id: str, retry_of: str,
                            worker_count: int) -> tuple[Dict[str, pd.DataFrame], dict]:
        """重拉失败股票，并用完整单股缓存原子重建聚合行情。"""
        self._reset_task_failures(task_id)
        self.login()
        try:
            start_date, end_date, date_key = self._date_range(lookback_days)
            all_stocks = self.get_main_board_stocks(end_date)
            if not all_stocks:
                raise ValueError("未获取到股票列表")

            try:
                self.load_kline_data(
                    stocks=stocks,
                    start_date=start_date,
                    end_date=end_date,
                    task_id=task_id,
                    force_update=True,
                    worker_count=worker_count,
                )
            except ValueError:
                raw_failed = self.r.smembers(f"task_failed_stocks:{task_id}")
                if len(raw_failed) >= len(stocks):
                    return {}, {
                        "totalCount": len(stocks),
                        "successCount": 0,
                        "failedCount": len(raw_failed),
                    }
                raise
            all_data = self.load_kline_data(
                stocks=all_stocks,
                start_date=start_date,
                end_date=end_date,
                force_update=False,
                worker_count=worker_count,
                allow_fetch_missing=False,
            )
            data = self._build_market_data(all_data)
            self._record_missing_stocks(task_id, stocks, set(data["close"].columns))
            self._save_cache(date_key, data)

            raw_failed = self.r.smembers(f"task_failed_stocks:{task_id}")
            failed = {
                code.decode() if isinstance(code, bytes) else code
                for code in raw_failed
            }
            repaired = [code for code in stocks if code not in failed]
            if repaired:
                self.r.srem(f"task_failed_stocks:{retry_of}", *repaired)
                self.r.hdel(f"task_failed_stock_errors:{retry_of}", *repaired)

            return data, {
                "totalCount": len(stocks),
                "successCount": len(repaired),
                "failedCount": len(failed),
            }
        finally:
            self.logout()

    def preload(self, lookback_days: int = LOOKBACK_DAYS, task_id: Optional[str] = None, force_update: bool = False, worker_count: int = 4):
        """预加载并缓存数据"""
        print(f"[DataLoader] 开始预加载... force_update={force_update}, worker_count={worker_count}")
        data = self.load_latest(lookback_days, task_id=task_id, force_update=force_update, worker_count=worker_count)
        self.logout()
        print("[DataLoader] 预加载完成")
        return data

_loader = DataLoader()

def load_market_data(lookback_days: int = LOOKBACK_DAYS,
                     end_date: Optional[str] = None,
                     worker_count: int = 4) -> Dict[str, pd.DataFrame]:
    try:
        return _loader.load_latest(lookback_days, end_date, worker_count=worker_count)
    finally:
        _loader.logout()

def preload_market_data(lookback_days: int = LOOKBACK_DAYS, task_id: Optional[str] = None, force_update: bool = False, worker_count: int = 4):
    return _loader.preload(lookback_days, task_id=task_id, force_update=force_update, worker_count=worker_count)
