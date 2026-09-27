import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import smart_runtime as smart


class SmartTest(unittest.TestCase):
    def test_read_and_cache_without_waking(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(smart, 'CACHE', Path(directory) / 'cache.json'), patch.object(smart.os.path, 'ismount', return_value=True):
            with patch.object(smart, 'run', side_effect=[SimpleNamespace(stdout='/dev/sda1\n'), SimpleNamespace(stdout='/dev/sda1 part\n/dev/sda disk\n'), SimpleNamespace(stdout=json.dumps({'power_on_time': {'hours': 123}}))]) as run:
                result = smart.power_on_hours('/')
                self.assertEqual(result['powerOnHours'], 123)
                self.assertEqual(smart.power_on_hours('/'), result)
                self.assertEqual(run.call_count, 3)
                self.assertIn('-r', run.call_args_list[1].args[0])
                self.assertEqual(run.call_args.args[0], ['/usr/sbin/smartctl', '-A', '-j', '-n', 'standby', '/dev/sda'])

    def test_sleeping_or_unsupported_is_not_zero(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(smart, 'CACHE', Path(directory) / 'cache.json'), patch.object(smart.os.path, 'ismount', return_value=True):
            with patch.object(smart, 'run', side_effect=[SimpleNamespace(stdout='/dev/sda1'), SimpleNamespace(stdout='/dev/sda disk'), SimpleNamespace(stdout='{}')]):
                self.assertEqual(smart.power_on_hours('/'), {})


if __name__ == '__main__':
    unittest.main()
