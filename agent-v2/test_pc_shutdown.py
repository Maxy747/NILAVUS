import hashlib
import unittest
from unittest.mock import patch
import max_docker
import pc_workers

class ShutdownTests(unittest.TestCase):
    def setUp(self):
        max_docker.LAST_SHUTDOWN_ATTEMPT = 0
        self.config = {'shutdownSalt': 'ab' * 16, 'shutdownHash': hashlib.pbkdf2_hmac('sha256', b'test-only', bytes.fromhex('ab' * 16), 200000).hex()}

    def test_bad_password_never_calls_bridge(self):
        with patch.object(max_docker, 'config', return_value=self.config), patch.object(max_docker, 'call') as call:
            with self.assertRaises(ValueError): max_docker.shutdown('wrong')
            call.assert_not_called()

    def test_password_and_rate_limit(self):
        with patch.object(max_docker, 'config', return_value=self.config), patch.object(max_docker, 'call', return_value={'ok': True}) as call:
            self.assertTrue(max_docker.shutdown('test-only')['ok'])
            call.assert_called_once_with('/shutdown', True)
            with self.assertRaises(ValueError): max_docker.shutdown('test-only')

    def test_shutdown_never_forces_apps(self):
        with patch.object(pc_workers.subprocess, 'run') as run:
            pc_workers.shutdown_pc()
            args = run.call_args.args[0]
            self.assertEqual(args[1:], ['/s', '/t', '0'])
            self.assertNotIn('/f', args)

if __name__ == '__main__': unittest.main()
