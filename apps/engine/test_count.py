import redis
import baostock as bs
import pickle
from app.config import settings

redis_url = settings.redis_url
r = redis.Redis.from_url(redis_url, decode_responses=True)

keys = r.keys("market_data:*")
r_bytes = redis.Redis.from_url(redis_url)
data = pickle.loads(r_bytes.get(keys[0]))
close_df = data.get('close')

cols = list(close_df.columns)
print("First 5:", cols[:5])
print("Last 5:", cols[-5:])
print("Total columns in df:", len(cols))

bs.login()
rs = bs.query_all_stock(day="2026-07-07")
all_stocks = []
while rs.next():
    row = rs.get_row_data()
    if row[1] == '1' and (row[0].startswith('sh.60') or row[0].startswith('sz.00')):
        all_stocks.append(row[0])
bs.logout()
print("Total valid stocks in baostock:", len(all_stocks))

# Check chunks
chunk_size = max(1, len(all_stocks) // 10)
chunks = [all_stocks[i:i + chunk_size] for i in range(0, len(all_stocks), chunk_size)]
for i, chunk in enumerate(chunks):
    found = sum(1 for c in chunk if c in cols)
    print(f"Chunk {i+1} ({len(chunk)} stocks): {found} found in df")
