import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[1] / 'tools/check_scope.py'
spec = importlib.util.spec_from_file_location('scope', path)
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)


class OwnershipTests(unittest.TestCase):
    def test_each_member_can_edit_only_owned_source(self):
        for member, folder in scope.FOLDERS.items():
            self.assertTrue(scope.allowed(folder + '/src/app.py', member))
            for other, other_folder in scope.FOLDERS.items():
                if member != other:
                    self.assertFalse(scope.allowed(other_folder + '/src/app.py', member))

    def test_root_owned_by_platform(self):
        self.assertTrue(scope.allowed('README.md', 1))
        self.assertFalse(scope.allowed('README.md', 2))

    def test_similar_prefix_and_parent_traversal_rejected(self):
        self.assertFalse(scope.allowed('member-2-personalization-copy/app.ts', 2))
        self.assertFalse(scope.allowed('member-2-personalization/../member-4-billing/Program.cs', 2))


if __name__ == '__main__':
    unittest.main()
