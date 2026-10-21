import os
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.update({
    'SERVICE_NAME':'reco-api', 'SERVICE_KEY':'test-only-key',
    'PROFILE_URL':'http://profile.invalid', 'CATALOG_URL':'http://catalog.invalid',
    'NEO4J_URL':'bolt://localhost:7687', 'NEO4J_PASSWORD':'test-only-password',
    'REDIS_URL':'redis://localhost:6379',
})
from fastapi.testclient import TestClient
from recommendation import main


class RecommendationApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.context = patch.object(main, 'context', return_value={'accountId':'a','profileId':'p','region':'IN','maturity':12})
        self.context.start()

    def tearDown(self):
        self.context.stop()
        self.client.close()

    def test_only_catalog_verified_titles_are_returned(self):
        candidates=[{'id':'a','published':True},{'id':'b','published':True}]
        response=Mock()
        response.json.return_value={'items':[{'id':'b','name':'Eligible'}]}
        with patch.object(main,'graph_candidates',return_value=(candidates,[])), patch.object(main.httpx,'post',return_value=response):
            result=self.client.get('/recommendations/home')
        self.assertEqual(200,result.status_code)
        self.assertEqual(['b'],[item['id'] for item in result.json()['items']])

    def test_metadata_failure_cannot_leak_unverified_ids(self):
        with patch.object(main,'graph_candidates',return_value=([{'id':'secret','published':True}],[])), patch.object(main.httpx,'post',side_effect=RuntimeError('outage')):
            result=self.client.get('/recommendations/home').json()
        self.assertEqual([],result['items'])
        self.assertTrue(result['degraded'])
        self.assertEqual('empty',result['source'])

    def test_graph_and_cache_failure_returns_empty_degraded(self):
        response=Mock()
        response.json.return_value={'items':[]}
        with patch.object(main,'graph_candidates',side_effect=RuntimeError('outage')), patch.object(main.cache,'get',side_effect=RuntimeError('outage')), patch.object(main.httpx,'post',return_value=response):
            result=self.client.get('/recommendations/trending').json()
        self.assertEqual([],result['items'])
        self.assertTrue(result['degraded'])

    def test_unbounded_query_rejected(self):
        self.assertEqual(400,self.client.get('/recommendations/home?limit=101').status_code)


if __name__=='__main__':
    unittest.main()
