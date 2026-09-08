import unittest

from ml_shadow.horizon_policy import apply_horizon_policy


class ShadowHorizonPolicyTest(unittest.TestCase):
    def test_15m_policy_inverts_and_recalibrates(self):
        out = apply_horizon_policy(15, "BUY", 0.62)
        self.assertEqual(out["direction"], "SELL")
        self.assertEqual(out["transform"], "INVERT")
        self.assertGreaterEqual(out["probability"], 0.5)
        self.assertLessEqual(out["probability"], 0.75)
        self.assertEqual(out["policy"]["frequencyImpact"], "NONE")

    def test_2m_forward_edge_is_retained(self):
        out = apply_horizon_policy(2, "SELL", 0.61)
        self.assertEqual(out["direction"], "SELL")
        self.assertEqual(out["probability"], 0.61)
        self.assertEqual(out["transform"], "RETAIN")

    def test_unknown_horizon_fails_safe_to_retain(self):
        out = apply_horizon_policy(99, "BUY", 0.58)
        self.assertEqual(out["direction"], "BUY")
        self.assertEqual(out["probability"], 0.58)
        self.assertEqual(out["transform"], "RETAIN")


if __name__ == "__main__":
    unittest.main()
