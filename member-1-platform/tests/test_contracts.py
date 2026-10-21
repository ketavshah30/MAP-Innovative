import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ContractTests(unittest.TestCase):
    def test_all_eleven_services_have_exactly_one_owner(self):
        services = json.loads((ROOT/'member-1-platform/contracts/services.json').read_text())['services']
        self.assertEqual(11, len({s['name'] for s in services}))
        self.assertEqual(11, len({s['port'] for s in services}))
        self.assertEqual({2,3,4,5}, {s['owner'] for s in services})
        declarations = {}
        for path in ROOT.glob('member-*/services.json'):
            owner = int(path.parent.name.split('-')[1])
            for service in json.loads(path.read_text())['services']:
                self.assertNotIn(service, declarations)
                declarations[service] = owner
        self.assertEqual({s['name']:s['owner'] for s in services}, declarations)

    def test_event_envelope_preserves_identity_and_allows_optional_extensions(self):
        schema = json.loads((ROOT/'member-1-platform/contracts/events/envelope.v1.schema.json').read_text())
        self.assertTrue({'id','subject','version','time','data'}.issubset(schema['required']))
        self.assertTrue(schema['additionalProperties'])
        self.assertEqual(1,schema['properties']['version']['minimum'])


if __name__=='__main__':
    unittest.main()
