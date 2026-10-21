"""CI entry point: trusted labels select the permitted member directory."""
import json
import os
from pathlib import Path
import subprocess
import sys

event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
labels = {label['name'] for label in event['pull_request']['labels']}
members = [n for n in range(1,6) if f'member-{n}' in labels]
if len(members) != 1:
    sys.exit('PR must have exactly one member-1 through member-5 label, assigned by a maintainer.')
sys.exit(subprocess.call([sys.executable,str(Path(__file__).with_name('check_scope.py')),'--member',str(members[0]),'--base',os.environ['BASE_SHA']]))
