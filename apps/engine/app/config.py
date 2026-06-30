from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "Stock Quant Engine"
    app_version: str = "1.0.0"
    debug: bool = False

    redis_url: str = "redis://localhost:6379"
    database_url: str = "postgresql://postgres:password@localhost:5432/stock_quant"
    queue_name: str = "stock:tasks:queue"


settings = Settings()
