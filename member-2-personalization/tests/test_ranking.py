import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recommendation.ranking import rank


class RankingTests(unittest.TestCase):
    def test_seen_and_deleted_are_excluded(self):
        candidates = [{"id":"a","published":True,"genres":["drama"]},{"id":"b","published":True,"genres":["drama"]},{"id":"c","published":True,"deleted":True}]
        self.assertEqual(rank(candidates,[candidates[0]]),["b"])

    def test_deterministic_tie_break_and_similarity(self):
        candidates = [{"id":"z","published":True,"genres":["action"]},{"id":"b","published":True,"genres":["drama"]},{"id":"a","published":True,"genres":["drama"]}]
        self.assertEqual(rank(candidates,[{"id":"seen","genres":["drama"]}],2),["a","b"])


if __name__ == '__main__':
    unittest.main()
