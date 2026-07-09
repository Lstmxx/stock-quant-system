import json
from unittest.mock import patch, MagicMock

import pytest

from app.core.alpha_miner import AlphaMiner

def test_alpha_miner_log_persists_to_redis_list():
    """
    Test that AlphaMiner._log both publishes to the channel and pushes to a redis list for polling.
    """
    with patch("app.core.alpha_miner.redis.Redis.from_url") as mock_redis:
        mock_client = MagicMock()
        mock_redis.return_value = mock_client
        
        miner = AlphaMiner(task_id="test_task_123")
        miner._log("Testing message")
        
        expected_msg = json.dumps({"message": "Testing message"})
        
        # Should still publish for streaming compatibility
        mock_client.publish.assert_called_with("task_log:test_task_123", expected_msg)
        
        # Should rpush and expire for polling functionality
        mock_client.rpush.assert_called_with("task_log_list:test_task_123", expected_msg)
        mock_client.expire.assert_called_with("task_log_list:test_task_123", 7200)
