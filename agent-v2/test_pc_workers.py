import unittest
from unittest.mock import patch
from types import SimpleNamespace
import max_docker
import pc_workers

class Tests(unittest.TestCase):
    def test_owner_gate(self):
        with patch.object(max_docker, 'config', return_value={'owner': 'owner@example.com'}):
            self.assertTrue(max_docker.allowed('127.0.0.1', True, 'owner@example.com'))
            self.assertFalse(max_docker.allowed('127.0.0.1', True, 'other@example.com'))
            self.assertFalse(max_docker.allowed('127.0.0.1', False, 'owner@example.com'))
            self.assertFalse(max_docker.allowed('100.1.2.3', True, 'owner@example.com'))
            self.assertFalse(max_docker.allowed('127.0.0.1', True, ''))

    def test_bridge_credentials(self):
        pc_workers.CONFIG = {'peer': '100.1.2.3', 'token': 'a' * 40}
        h = object.__new__(pc_workers.Handler)
        h.client_address = ('100.1.2.3', 123)
        h.headers = {'Authorization': 'Bearer ' + 'a' * 40}
        self.assertTrue(h.authorized())
        h.headers = {}
        self.assertFalse(h.authorized())

    def test_only_stopped_allowlisted_worker_started(self):
        calls = []
        def fake(*args, **kwargs):
            calls.append(args)
            value = 'running' if 'immich_machine_learning' in args else 'exited'
            return SimpleNamespace(returncode=0, stdout=value)
        with patch.object(pc_workers, 'docker', side_effect=fake):
            pc_workers.LOCK.acquire()
            pc_workers.start_workers()
        self.assertEqual([c for c in calls if c[0] == 'start'], [('start', 'immich_pc_microservices')])

    def test_unreachable_is_not_stopped(self):
        max_docker.CACHE = (0, None)
        with patch.object(max_docker, 'call', side_effect=OSError):
            self.assertIsNone(max_docker.status()['engine'])

if __name__ == '__main__':
    unittest.main()
