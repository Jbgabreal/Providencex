"""Verify the correct MT5 path"""
from pathlib import Path

correct_path = Path(r"C:\Program Files\XM Global MT5\terminal64.exe")
print(f"Checking path: {correct_path}")
print(f"Exists: {correct_path.exists()}")

if correct_path.exists():
    print("✓ Correct path found!")
    print(f"\n💡 Update your .env file with:")
    print(f"   MT5_PATH=C:\\Program Files\\XM Global MT5\\terminal64.exe")
else:
    print("✗ Path does not exist")

