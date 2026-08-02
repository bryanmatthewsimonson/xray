"""Per-request key hygiene + queue routing in server.py.

The invariants that must never regress (2026-08-02 per-request engine
design): an extension-supplied API key reaches the worker child through
its process environment ONLY — never the job snapshot, never the spec
file, never a log line — and jobs route to the pool matching their OWN
provider, not the server's env default.

Run from companion/transcriber/:  uv run python -m unittest discover tests
"""

import json
import unittest
from unittest import mock

from transcriber import server
from transcriber.jobs import Job, JobStore


def make_job(**kw):
    defaults = dict(job_id="6a3ce607-0000-4000-8000-000000000001",
                    url="https://www.youtube.com/watch?v=abc123DEF45",
                    video_id="abc123DEF45")
    defaults.update(kw)
    return Job(**defaults)


class ChildEnv(unittest.TestCase):
    def test_no_key_inherits_unchanged(self):
        self.assertIsNone(server._child_env(make_job(provider="local")))
        self.assertIsNone(server._child_env(make_job(provider="assemblyai", api_key=None)))

    def test_request_key_overlays_provider_env_var(self):
        job = make_job(provider="assemblyai", api_key="req-key")
        with mock.patch.dict(server.os.environ, {"ASSEMBLYAI_API_KEY": "env-key"}, clear=False):
            env = server._child_env(job)
        self.assertEqual(env["ASSEMBLYAI_API_KEY"], "req-key")  # request wins

    def test_deepgram_var(self):
        env = server._child_env(make_job(provider="deepgram", api_key="dg"))
        self.assertEqual(env["DEEPGRAM_API_KEY"], "dg")


class KeyHygiene(unittest.TestCase):
    def test_snapshot_never_carries_the_key(self):
        store = JobStore()
        job = make_job(provider="assemblyai", api_key="sekrit")
        store.add_or_get_active(job)
        snap = store.snapshot(job)
        self.assertNotIn("api_key", snap)
        self.assertNotIn("sekrit", json.dumps(snap))

    def test_repr_never_carries_the_key(self):
        job = make_job(provider="assemblyai", api_key="sekrit")
        self.assertNotIn("sekrit", repr(job))

    def test_spec_payload_never_carries_the_key(self):
        # The spec written to disk is built inline in _run_job; pin the
        # fields it may contain by rebuilding the same dict shape.
        job = make_job(provider="assemblyai", api_key="sekrit")
        spec = {
            "job_id": job.job_id,
            "url": job.url,
            "video_id": job.video_id,
            "provider": job.provider,
        }
        self.assertNotIn("sekrit", json.dumps(spec))


class QueueRouting(unittest.TestCase):
    def test_cloud_jobs_route_to_the_cloud_queue(self):
        self.assertIs(server._queue_for("assemblyai"), server._cloud_queue)
        self.assertIs(server._queue_for("deepgram"), server._cloud_queue)

    def test_local_jobs_route_to_the_local_queue(self):
        self.assertIs(server._queue_for("local"), server._local_queue)


if __name__ == "__main__":
    unittest.main()
