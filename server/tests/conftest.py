import sys
from pathlib import Path

# server/ 를 sys.path에 넣어 app.* 임포트 가능하게 한다.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
