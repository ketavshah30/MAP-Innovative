"""Reject changes outside a member's owned folder, including staged/untracked work."""
import argparse
import pathlib
import subprocess
import sys

PROJECT = pathlib.Path(__file__).resolve().parents[2]
FOLDERS = {1: "member-1-platform", 2: "member-2-personalization", 3: "member-3-catalog", 4: "member-4-billing", 5: "member-5-playback"}


def allowed(relative, member):
    parts = pathlib.PurePosixPath(relative).parts
    if not parts or ".." in parts:
        return False
    return parts[0] == FOLDERS[member] or (member == 1 and (len(parts) == 1 or parts[0] == '.github'))


def git(*args):
    return subprocess.check_output(["git", "-C", str(PROJECT), *args]).decode().strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--member", type=int, choices=FOLDERS, required=True)
    parser.add_argument("--base", required=True, help="Existing base ref; committed diff uses merge-base semantics")
    args = parser.parse_args()
    repo = pathlib.Path(git("rev-parse", "--show-toplevel")).resolve()
    prefix = PROJECT.relative_to(repo).as_posix()
    prefix = "" if prefix == "." else prefix + "/"
    # Disable rename detection so both the removed and added path are checked.
    paths = set()
    for command in [("diff", "--no-renames", "--name-only", "-z", f"{args.base}...HEAD"), ("diff", "--no-renames", "--name-only", "-z", "HEAD"), ("ls-files", "--others", "--exclude-standard", "-z")]:
        raw = subprocess.check_output(["git", "-C", str(repo), *command])
        paths.update(p.decode("utf-8") for p in raw.split(b"\0") if p)
    project_paths = [p[len(prefix):] for p in paths if p.startswith(prefix)]
    violations = sorted(p for p in project_paths if not allowed(p, args.member))
    if violations:
        print("Outside your ownership boundary:\n" + "\n".join(violations))
        return 1
    print(f"Member {args.member}: ownership check passed ({len(project_paths)} project paths).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
