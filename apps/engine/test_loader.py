import os
import sys

# use absolute import or sys.path, actually relative import should work if we run from app/
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.core.data_loader import DataLoader

loader = DataLoader()
stocks = loader.get_main_board_stocks()
loader.logout()
