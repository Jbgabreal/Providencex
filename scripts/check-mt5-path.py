"""Check if MT5 path exists and find alternatives"""
from pathlib import Path

mt5_path = Path(r"C:\Program Files\MetaTrader 5\terminal64.exe")
print(f"Checking MT5 path: {mt5_path}")
print(f"Exists: {mt5_path.exists()}")

if not mt5_path.exists():
    print("\nChecking alternative locations...")
    alt_locations = [
        Path(r"C:\Program Files\MetaTrader 5"),
        Path(r"C:\Program Files (x86)\MetaTrader 5"),
        Path.home() / "AppData" / "Roaming" / "MetaQuotes" / "Terminal",
    ]
    
    found_exes = []
    for loc in alt_locations:
        if loc.exists():
            print(f"\n✓ Found directory: {loc}")
            # Look for terminal64.exe in subdirectories
            for exe in loc.rglob("terminal64.exe"):
                print(f"  → Found: {exe}")
                found_exes.append(exe)
        else:
            print(f"✗ Not found: {loc}")
    
    if found_exes:
        print(f"\n💡 Recommendation: Update MT5_PATH in .env to:")
        print(f"   MT5_PATH={found_exes[0]}")
    else:
        print("\n⚠️  No terminal64.exe found. MT5 may not be installed.")

