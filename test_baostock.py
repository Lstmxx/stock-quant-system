import baostock as bs
import time

print("Logging in...", flush=True)
bs.login()
print("Logged in successfully!", flush=True)
bs.logout()
