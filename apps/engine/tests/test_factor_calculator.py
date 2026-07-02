import pytest
import pandas as pd
import numpy as np

from app.core.factor_calculator import FactorCalculator

@pytest.fixture
def dummy_market_data():
    dates = pd.date_range('2026-01-01', periods=5)
    stocks = [f'sh.6000{i:02d}' for i in range(15)]
    
    # Create fake prices
    np.random.seed(42)
    close_data = pd.DataFrame(np.random.randn(5, 15) + 10, index=dates, columns=stocks)
    volume_data = pd.DataFrame(np.random.rand(5, 15) * 1000, index=dates, columns=stocks)
    amount_data = close_data * volume_data
    turn_data = pd.DataFrame(np.random.rand(5, 15) * 5, index=dates, columns=stocks) # 0 to 5%
    
    # Create fake industry data (broadcasted to the same shape)
    # alternate Bank and Tech
    ind_list = ['Bank' if i % 2 == 0 else 'Tech' for i in range(15)]
    ind_series = pd.Series(ind_list, index=stocks)
    industry_data = pd.DataFrame([ind_series]*5, index=dates, columns=stocks)
    
    return {
        'close': close_data,
        'volume': volume_data,
        'amount': amount_data,
        'turn': turn_data,
        'industry': industry_data
    }

def test_winsorize_cross_sectional():
    calc = FactorCalculator()
    dates = pd.date_range('2026-01-01', periods=3)
    stocks = ['A', 'B', 'C']
    
    # A jumps to 5 on Day 3. Time-series mean for A=2.33, std=2.3.
    # At n_std=1.0, time-series upper bound for A is 4.63.
    # But on Day 3, cross-section is [5, 5, 5], mean=5, std=0.
    # Cross-sectional shouldn't clip 5.
    data = np.array([
        [1.0, 1.0, 1.0],  # Day 1
        [1.0, 1.0, 1.0],  # Day 2
        [5.0, 5.0, 5.0],  # Day 3
    ])
    df = pd.DataFrame(data, index=dates, columns=stocks)
    
    clipped = calc._winsorize(df, n_std=1.0)
    
    # Under correct cross-sectional winsorization, Day 3 values remain 5.0
    assert clipped.loc[dates[2], 'A'] == 5.0

def test_neutralize_orthogonalization(dummy_market_data):
    calc = FactorCalculator()
    
    amount = dummy_market_data['amount']
    turn = dummy_market_data['turn']
    size = np.log(amount / (turn / 100 + 1e-8))
    
    # Raw factor is highly correlated with size
    raw_factor = size * 2.5 + np.random.randn(*size.shape) * 0.1
    
    neutralized = calc._neutralize(raw_factor, dummy_market_data)
    day1_neut = neutralized.iloc[0].astype(float)
    day1_size = size.iloc[0].astype(float)
    corr = np.corrcoef(day1_neut, day1_size)[0, 1]
    assert abs(corr) < 1e-7, f"Correlation with size should be 0, got {corr}"
