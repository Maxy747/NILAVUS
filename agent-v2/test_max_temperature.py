import unittest
from datetime import datetime, timezone
from max_core import temperature_report


class TemperatureReportTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 27, 6, tzinfo=timezone.utc)
        self.ctx = {"nodes": {"nilavus": {"online": True, "temperatureC": 50},
                              "nilavus-storage": {"online": True, "temperatureC": 40}}}

    def test_history_and_comparison(self):
        saved = {"nodes": {"nilavus": [
            {"sampled_at": "2026-09-27T05:58:00Z", "temperature_c": 50},
            {"sampled_at": "2026-09-27T05:59:00Z", "temperature_c": 90}]}}
        report = temperature_report(self.ctx, saved, self.now)
        self.assertIn("laptop) is hotter", report)
        self.assertIn("average 70.0C", report)
        self.assertIn("CRITICAL", report)
        self.assertIn("11:29 IST", report)
        self.assertIn("History has gaps", report)
        self.assertLess(len(report.split()), 130)
        self.assertIn("no saved readings today", report)

    def test_missing_and_tie(self):
        self.ctx["nodes"]["nilavus-storage"]["temperatureC"] = 50
        report = temperature_report(self.ctx, None, self.now)
        self.assertIn("both at 50C", report)
        self.assertIn("history unavailable", report)

    def test_offline_and_previous_day(self):
        self.ctx["nodes"]["nilavus"]["online"] = False
        saved = {"nodes": {"nilavus": [{"sampled_at": "2026-09-26T18:00:00Z", "temperature_c": 99}]}}
        report = temperature_report(self.ctx, saved, self.now)
        self.assertIn("current temperature unavailable", report)
        self.assertNotIn("99.0", report)


if __name__ == '__main__':
    unittest.main()
