from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Stock Quant Engine"
    app_version: str = "1.0.0"
    debug: bool = False

    redis_url: str
    database_url: str
    queue_name: str = "stock:tasks:queue"
    llm_selection_concurrency: int = 4


settings = Settings()
