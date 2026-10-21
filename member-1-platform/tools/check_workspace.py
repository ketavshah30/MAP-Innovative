"""Fast dependency-free checks for ownership layout and contract consistency."""
import ast
import json
import os
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
FOLDERS = {1:'member-1-platform',2:'member-2-personalization',3:'member-3-catalog',4:'member-4-billing',5:'member-5-playback'}


def check():
    errors = []
    registry = json.loads((ROOT / FOLDERS[1] / 'contracts/services.json').read_text())['services']
    if len(registry) != 11 or len({s['name'] for s in registry}) != 11:
        errors.append('Exactly eleven unique application services are required')
    if len({s['port'] for s in registry}) != 11:
        errors.append('Service ports overlap')
    expected = {s['name']: s['owner'] for s in registry}
    actual = {}
    for member, folder in FOLDERS.items():
        directory = ROOT / folder
        for required in ['README.md', 'OWNERSHIP.md']:
            if not (directory / required).exists():
                errors.append(f'{folder}/{required} missing')
        if member == 1:
            continue
        for name in json.loads((directory / 'services.json').read_text())['services']:
            if name in actual:
                errors.append(f'Duplicate service owner: {name}')
            actual[name] = member
    if actual != expected:
        errors.append(f'Service owner mismatch: {actual}')
    excludes = {'.local','node_modules','dist','target','bin','obj','.venv','__pycache__','.git'}
    for directory, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in excludes]
        for filename in files:
            path = Path(directory) / filename
            try:
                if path.suffix == '.json':
                    json.loads(path.read_text(encoding='utf-8'))
                if path.suffix in ('.xml','.csproj'):
                    ET.parse(path)
                if path.suffix == '.py':
                    ast.parse(path.read_text(encoding='utf-8'),filename=str(path))
            except Exception as error:
                errors.append(f'{path.relative_to(ROOT)}: {error}')
    return errors


if __name__ == '__main__':
    errors = check()
    if errors:
        print('\n'.join(errors))
        sys.exit(1)
    print('Workspace checks passed: five owners, eleven unique services, unique ports, valid JSON/XML/Python.')
