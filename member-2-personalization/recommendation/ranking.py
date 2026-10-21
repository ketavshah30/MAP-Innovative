from collections import Counter


def rank(candidates, watched, limit=20):
    """Deterministic content overlap plus bounded popularity, excluding watched IDs."""
    affinity = Counter(genre for item in watched for genre in item.get("genres", []))
    seen = {item["id"] for item in watched}
    scored = []
    for item in candidates:
        if item["id"] in seen or item.get("deleted") or not item.get("published"):
            continue
        overlap = sum(affinity[g] for g in item.get("genres", []))
        popularity = min(max(int(item.get("watches", 0)), 0), 1000) / 1000
        scored.append((overlap + popularity, item["id"]))
    return [title_id for _, title_id in sorted(scored, key=lambda row: (-row[0], row[1]))[:limit]]
