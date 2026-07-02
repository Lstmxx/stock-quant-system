from app.config import settings

def test_config_loads_from_root_env():
    """
    Test that the config object correctly reads the redis and database urls 
    from the root .env file.
    """
    assert settings.redis_url == "redis://localhost:6379", f"Expected redis://localhost:6379, got {settings.redis_url}"
    assert settings.database_url == "postgresql://postgres:postgres@localhost:5432/stock_quant", f"Expected stock_quant pg db, got {settings.database_url}"
