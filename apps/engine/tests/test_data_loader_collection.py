from unittest.mock import MagicMock

import pandas as pd

from app.core.data_loader import DataLoader


def make_loader() -> DataLoader:
    loader = object.__new__(DataLoader)
    loader._logged_in = False
    loader.r = MagicMock()
    return loader


def test_save_cache_replaces_aggregate_key_atomically() -> None:
    loader = make_loader()
    pipeline = loader.r.pipeline.return_value

    loader._save_cache("2026-07-14_250", {"close": pd.DataFrame()})

    pipeline.set.assert_called_once()
    temporary_key = pipeline.set.call_args.args[0]
    assert temporary_key.startswith("market_data:2026-07-14_250:tmp:")
    assert pipeline.set.call_args.kwargs["ex"] == 20 * 3600
    pipeline.rename.assert_called_once_with(
        temporary_key,
        "market_data:2026-07-14_250",
    )
    pipeline.execute.assert_called_once_with()


def test_retry_rebuilds_full_aggregate_and_clears_repaired_stocks() -> None:
    loader = make_loader()
    loader.login = MagicMock()
    loader.logout = MagicMock()
    loader.get_main_board_stocks = MagicMock(
        return_value=["sh.600000", "sz.000001", "sz.000002"]
    )
    target_frame = pd.DataFrame({"code": ["sh.600000"]})
    full_frame = pd.DataFrame({"code": ["sh.600000", "sz.000001"]})
    loader.load_kline_data = MagicMock(side_effect=[target_frame, full_frame])
    aggregate = {"close": pd.DataFrame(columns=["sh.600000", "sz.000001"])}
    loader._build_market_data = MagicMock(return_value=aggregate)
    loader._save_cache = MagicMock()
    loader.r.smembers.return_value = {b"sz.000002"}

    data, summary = loader.retry_failed_stocks(
        stocks=["sh.600000", "sz.000002"],
        lookback_days=250,
        task_id="retry-task",
        retry_of="original-task",
        worker_count=4,
    )

    assert data is aggregate
    assert summary == {"totalCount": 2, "successCount": 1, "failedCount": 1}
    assert loader.load_kline_data.call_count == 2
    assert loader.load_kline_data.call_args_list[1].kwargs["allow_fetch_missing"] is False
    loader._save_cache.assert_called_once()
    loader.r.srem.assert_called_once_with(
        "task_failed_stocks:original-task",
        "sh.600000",
    )
    loader.r.hdel.assert_called_once_with(
        "task_failed_stock_errors:original-task",
        "sh.600000",
    )
    loader.logout.assert_called_once_with()
