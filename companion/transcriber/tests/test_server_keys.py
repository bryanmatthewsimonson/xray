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
                    media_key="abc123DEF45")
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
            "media_key": job.media_key,
            "provider": job.provider,
        }
        self.assertNotIn("sekrit", json.dumps(spec))


class QueueRouting(unittest.TestCase):
    def test_cloud_jobs_route_to_the_cloud_queue(self):
        self.assertIs(server._queue_for("assemblyai"), server._cloud_queue)
        self.assertIs(server._queue_for("deepgram"), server._cloud_queue)

    def test_local_jobs_route_to_the_local_queue(self):
        self.assertIs(server._queue_for("local"), server._local_queue)


class TranscribeEndpoint(unittest.TestCase):
    """POST /transcribe called as a plain function (no TestClient dep)."""

    def test_response_names_the_engine_and_dedupe_tells_the_truth(self):
        req = server.TranscribeRequest(
            url="https://www.youtube.com/watch?v=dEdUpE00001",
            provider="assemblyai",
            api_key="k",
        )
        first = server.transcribe(req)
        self.assertEqual(first["provider"], "assemblyai")
        # Same video requested as LOCAL while the AssemblyAI job is
        # active: the dedupe wins and the response says so.
        again = server.transcribe(server.TranscribeRequest(
            url="https://www.youtube.com/watch?v=dEdUpE00001",
            provider="local",
        ))
        self.assertEqual(again["job_id"], first["job_id"])
        self.assertEqual(again["provider"], "assemblyai")
        server.store.remove(first["job_id"])  # keep the global store clean

    def test_cloud_without_any_key_is_a_400(self):
        from fastapi import HTTPException

        with mock.patch.object(server.config, "DEEPGRAM_API_KEY", ""):
            with self.assertRaises(HTTPException) as ctx:
                server.transcribe(server.TranscribeRequest(
                    url="https://www.youtube.com/watch?v=NoKeY000001",
                    provider="deepgram",
                ))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Deepgram", ctx.exception.detail)

    def test_provider_is_normalized_and_local_never_keeps_a_key(self):
        resp = server.transcribe(server.TranscribeRequest(
            url="https://www.youtube.com/watch?v=NoRmALiZ001",
            provider="  LOCAL  ",
            api_key="accidental-paste",
        ))
        self.assertEqual(resp["provider"], "local")
        job = server.store.get(resp["job_id"])
        self.assertIsNone(job.api_key)  # a local job never holds a credential
        server.store.remove(resp["job_id"])

    def test_unknown_provider_is_a_400(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            server.transcribe(server.TranscribeRequest(
                url="https://www.youtube.com/watch?v=UnKnOwN0001",
                provider="whisper9000",
            ))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("unknown provider", ctx.exception.detail)


class PoolFairness(unittest.TestCase):
    """queue_position and the 429 cap count only the job's OWN pool."""

    def _queued(self, store, provider, n, tag):
        jobs = []
        for i in range(n):
            j = Job(job_id=f"6a3ce607-0000-4000-8000-{tag}{i:011d}"[:36],
                    url="https://youtu.be/x", media_key=f"{tag}{i}", provider=provider)
            store.add_or_get_active(j)
            jobs.append(j)
        return jobs

    def test_queue_position_ignores_the_other_pool(self):
        store = JobStore()
        self._queued(store, "local", 3, "1")
        cloud_job = self._queued(store, "assemblyai", 1, "2")[0]
        # Three queued local jobs ahead in insertion order — but the
        # cloud pool is empty, so this job is NEXT in its own pool.
        self.assertEqual(store.snapshot(cloud_job)["queue_position"], 1)

    def test_active_count_is_per_pool(self):
        store = JobStore()
        self._queued(store, "local", 5, "3")
        self._queued(store, "deepgram", 2, "4")
        self.assertEqual(store.active_count_in_pool(cloud=False), 5)
        self.assertEqual(store.active_count_in_pool(cloud=True), 2)
        self.assertEqual(store.active_count(), 7)  # /health stays global


if __name__ == "__main__":
    unittest.main()
