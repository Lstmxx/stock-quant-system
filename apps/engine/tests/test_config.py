import os
from urllib.parse import urlparse

import pytest
from dotenv import dotenv_values

from app.config import ROOT_ENV_FILE, Settings, settings


def _expected_value(key: str) -> str:
    value = os.environ.get(key) or dotenv_values(ROOT_ENV_FILE).get(key)
    if not value:
        pytest.fail(f"{key} must be configured in the repository root .env")
    return value


def _assert_matches_without_leaking(key: str, actual: str) -> None:
    if actual != _expected_value(key):
        pytest.fail(f"{key} was not loaded from the effective root environment")


def test_config_loads_from_root_env_without_hardcoded_credentials(tmp_path, monkeypatch):
    _assert_matches_without_leaking("REDIS_URL", settings.redis_url)
    _assert_matches_without_leaking("DATABASE_URL", settings.database_url)

    database = urlparse(settings.database_url)
    assert database.scheme in {"postgres", "postgresql"}
    assert database.hostname
    assert database.path not in {"", "/"}

    monkeypatch.chdir(tmp_path)
    reloaded = Settings()
    _assert_matches_without_leaking("REDIS_URL", reloaded.redis_url)
    _assert_matches_without_leaking("DATABASE_URL", reloaded.database_url)
