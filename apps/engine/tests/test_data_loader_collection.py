import json
from unittest.mock import MagicMock, patch

import pandas as pd

from app.core.data_loader import DataLoader, _fetch_stock_chunk


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


def test_fetch_stock_chunk_replaces_stable_cache_across_date_ranges() -> None:
    cache_values: dict[str, bytes] = {}

    def store_cache(key: str, value: str, *, ex: int) -> None:
        assert ex == 7 * 24 * 3600
        cache_values[key] = value.encode()

    cache_client = MagicMock()
    cache_client.set.side_effect = store_cache
    cache_client.get.side_effect = cache_values.get
    batches = [
        (
            "2026-08-26",
            [["2026-08-26", "sh.600000", "", "", "", "10", "", "", "", ""]],
        ),
        (
            "2026-08-27",
            [
                ["2026-08-26", "sh.600000", "", "", "", "11", "", "", "", ""],
                ["2026-08-27", "sh.600000", "", "", "", "12", "", "", "", ""],
            ],
        ),
    ]
    query_results = []
    for _, rows in batches:
        query_result = MagicMock(error_code="0")
        query_result.next.side_effect = [True] * len(rows) + [False]
        query_result.get_row_data.side_effect = rows
        query_results.append(query_result)

    with (
        patch("app.core.data_loader.redis.Redis.from_url", return_value=cache_client),
        patch("app.core.data_loader.bs.login", return_value=MagicMock(error_code="0")),
        patch("app.core.data_loader.bs.query_history_k_data_plus", side_effect=query_results),
        patch("app.core.data_loader.time.sleep"),
        patch("app.core.data_loader.signal.signal"),
        patch("app.core.data_loader.signal.alarm"),
    ):
        for end_date, rows in batches:
            result = _fetch_stock_chunk(
                (
                    0,
                    ["sh.600000"],
                    "2026-01-01",
                    end_date,
                    "date,code,open,high,low,close,volume,amount,turn,pctChg",
                    "redis://cache.invalid/0",
                    None,
                )
            )

            assert result == rows
            assert json.loads(cache_client.get("kline:sh.600000")) == rows
            assert set(cache_values) == {"kline:sh.600000"}

    assert cache_client.set.call_count == 2


def test_pivot_data_keeps_last_duplicate_date_and_symbol() -> None:
    loader = make_loader()
    frame = pd.DataFrame(
        {
            "date": ["2026-08-27", "2026-08-27"],
            "code": ["sh.600000", "sh.600000"],
            "close": [10.0, 11.0],
        }
    )

    result = loader.pivot_data(frame)

    assert result["close"].loc[pd.Timestamp("2026-08-27"), "sh.600000"] == 11.0


def test_load_kline_data_prefers_stable_cache() -> None:
    loader = make_loader()
    loader.r.mget.return_value = [
        b'[["2026-08-27", "sh.600000", "", "", "", "11", "", "", "", ""]]'
    ]

    result = loader.load_kline_data(
        stocks=["sh.600000"],
        start_date="2026-01-01",
        end_date="2026-08-27",
        allow_fetch_missing=False,
    )

    assert result["close"].tolist() == [11]
    assert loader.r.mget.call_args_list[0].args == (["kline:sh.600000"],)


def test_load_kline_data_falls_back_to_legacy_cache() -> None:
    loader = make_loader()
    loader.r.mget.side_effect = [
        [None],
        [b'[["2026-08-27", "sh.600000", "", "", "", "10", "", "", "", ""]]'],
    ]

    result = loader.load_kline_data(
        stocks=["sh.600000"],
        start_date="2026-01-01",
        end_date="2026-08-27",
        allow_fetch_missing=False,
    )

    assert result["close"].tolist() == [10]
    assert loader.r.mget.call_args_list[1].args == (
        ["kline:sh.600000:2026-01-01_2026-08-27"],
    )


def test_load_kline_data_deduplicates_symbols_before_cache_read() -> None:
    loader = make_loader()
    loader.r.mget.side_effect = [
        [b'[["2026-08-27", "sh.600000", "", "", "", "11", "", "", "", ""]]'],
        [None],
    ]

    result = loader.load_kline_data(
        stocks=["sh.600000", "sh.600000"],
        start_date="2026-01-01",
        end_date="2026-08-27",
        allow_fetch_missing=False,
    )

    assert result["close"].tolist() == [11]
    assert loader.r.mget.call_args_list[0].args == (["kline:sh.600000"],)


def test_load_kline_data_filters_range_and_keeps_last_valid_duplicate() -> None:
    loader = make_loader()
    rows = [
        ["2025-12-31", "sh.600000", "", "", "", "9", "", "", "", ""],
        ["2026-08-27", "sh.600000", "", "", "", "10", "", "", "", ""],
        ["2026-08-27", "sh.600000", "", "", "", "11", "", "", "", ""],
        ["2026-08-27", "sh.600000", "", "", "", "invalid", "", "", "", ""],
        ["2026-08-27", "sh.600000", "", "", "", "0", "", "", "", ""],
        ["invalid-date", "sh.600000", "", "", "", "99", "", "", "", ""],
        ["2026-08-28", "sh.600000", "", "", "", "12", "", "", "", ""],
    ]
    loader.r.mget.return_value = [json.dumps(rows).encode()]

    result = loader.load_kline_data(
        stocks=["sh.600000"],
        start_date="2026-01-01",
        end_date="2026-08-27",
        allow_fetch_missing=False,
    )

    assert result["date"].tolist() == [pd.Timestamp("2026-08-27")]
    assert result["close"].tolist() == [11]
    assert loader.pivot_data(result)["close"].loc[pd.Timestamp("2026-08-27"), "sh.600000"] == 11
