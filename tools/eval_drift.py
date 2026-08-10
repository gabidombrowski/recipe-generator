#!/usr/bin/env python3
"""Trend report over the weekly eval-run artifacts.

The Evals workflow uploads ``eval-report.json`` per run and nobody reads raw
artifacts, so the weekly cron was producing signal with no consumer. This tool
is the consumer: it pulls the recent reports and prints per-gate pass rates,
cost and latency as a trend, newest last, so a slow prompt regression shows up
as a column drifting rather than as a surprise gate failure.

Concurrency note, since this file doubles as the answer to "how do you write
concurrent code in Python": the work here is I/O-bound (HTTP to the GitHub
API), so it uses ``asyncio`` with the blocking ``urllib`` calls pushed through
``asyncio.to_thread`` and a semaphore bounding parallelism — the same shape as
``mapWithConcurrency`` on the TypeScript side, and for the same reason: the
interesting parameter is the cap, not the parallelism. For CPU-bound work none
of this would help; that is what ``concurrent.futures.ProcessPoolExecutor`` is
for, since threads share the interpreter and native async shares one thread.

Auth comes from ``GITHUB_TOKEN``/``GH_TOKEN``; the repository from ``--repo``
or ``GITHUB_REPOSITORY``. Neither is defaulted to a real name on purpose —
this repo keeps identities out of committed code.

Usage::

    GITHUB_TOKEN=$(gh auth token) python3 tools/eval_drift.py --repo owner/name
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import os
import ssl
import sys
import urllib.request
import zipfile
from dataclasses import dataclass
from typing import Any, Final

API: Final = "https://api.github.com"
WORKFLOW: Final = "evals.yml"
FETCH_CONCURRENCY: Final = 4


@dataclass(frozen=True)
class GateResult:
    """One assertion's aggregate for one run."""

    passed: int
    total: int

    @property
    def rate(self) -> float:
        return self.passed / self.total if self.total else 0.0


@dataclass(frozen=True)
class RunReport:
    """The slice of eval-report.json this report cares about."""

    run_id: int
    finished_at: str
    gates: dict[str, GateResult]
    cost_usd: float
    median_latency_ms: int


# A stock python.org install on macOS ships without a CA bundle wired up, so
# every TLS handshake fails until someone runs its "Install Certificates"
# step. Preferring certifi when present and the system store otherwise makes
# the tool work in CI and on a laptop without insisting on either environment.
try:  # optional dependency; the system store is the normal path
    import certifi

    _CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:  # pragma: no cover - depends on the host environment
    _CTX = ssl.create_default_context()


class _CrossHostRedirects(urllib.request.HTTPRedirectHandler):
    """Drop the Authorization header when a redirect leaves the origin host.

    Artifact downloads answer with a 302 to blob storage, and the storage host
    rejects a request that still carries the GitHub bearer token — its 401 is
    this tool's most likely first failure. Forwarding credentials across hosts
    is also exactly what a client should not do, so the fix and the hygiene
    coincide.
    """

    def redirect_request(  # noqa: N802 - urllib's naming, not ours
        self,
        req: urllib.request.Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> urllib.request.Request | None:
        fresh = super().redirect_request(req, fp, code, msg, headers, newurl)
        if fresh is not None and req.host != fresh.host:
            fresh.remove_header("Authorization")
        return fresh


_OPENER = urllib.request.build_opener(
    _CrossHostRedirects(), urllib.request.HTTPSHandler(context=_CTX)
)


def _request(url: str, token: str) -> bytes:
    """Blocking fetch; always dispatched via ``asyncio.to_thread``."""
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "eval-drift",
        },
    )
    with _OPENER.open(req, timeout=30) as resp:
        return resp.read()  # type: ignore[no-any-return]


async def fetch_json(url: str, token: str) -> Any:
    return json.loads(await asyncio.to_thread(_request, url, token))


def parse_report(raw: bytes, run_id: int) -> RunReport | None:
    """Extract the trend fields; None for a malformed or pre-schema report."""
    try:
        data = json.loads(raw)
        # Field names come from evals/runner.ts's AssertionSummary — the
        # producer's schema, not a guess. `evaluated` rather than `total`:
        # skipped runs (a failed generation) are excluded from a gate's
        # denominator by the runner, and this report keeps that meaning.
        gates = {
            str(a["id"]): GateResult(int(a["passed"]), int(a["evaluated"]))
            for a in data["assertions"]
        }
        runs = data.get("runs", [])
        latencies = sorted(int(r.get("latencyMs", 0)) for r in runs if r.get("ok"))
        median = latencies[len(latencies) // 2] if latencies else 0
        cost = float(sum(r.get("costUsd", 0.0) for r in runs))
        return RunReport(
            run_id=run_id,
            finished_at=str(data.get("finishedAt", ""))[:10],
            gates=gates,
            cost_usd=cost,
            median_latency_ms=median,
        )
    except (KeyError, ValueError, TypeError) as error:
        print(f"  run {run_id}: unreadable report ({error!r})", file=sys.stderr)
        return None


async def report_for_run(
    repo: str, run: dict[str, Any], token: str, gate: asyncio.Semaphore
) -> RunReport | None:
    """Download one run's report artifact, bounded by the semaphore."""
    async with gate:
        run_id = int(run["id"])
        artifacts = await fetch_json(
            f"{API}/repos/{repo}/actions/runs/{run_id}/artifacts", token
        )
        match = next(
            (
                a
                for a in artifacts.get("artifacts", [])
                if str(a["name"]).startswith("eval-report")
            ),
            None,
        )
        if match is None:
            return None  # unarmed run, or the suite died before reporting

        archive = await asyncio.to_thread(
            _request, str(match["archive_download_url"]), token
        )
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            name = next(
                (n for n in bundle.namelist() if n.endswith("eval-report.json")),
                None,
            )
            if name is None:
                return None
            return parse_report(bundle.read(name), run_id)


def render(reports: list[RunReport]) -> str:
    """Oldest first, so reading down the table is reading forward in time."""
    if not reports:
        return "No runs with report artifacts found."

    gate_ids = sorted({g for r in reports for g in r.gates})
    header = ["date", *gate_ids, "cost", "p50"]
    rows: list[list[str]] = []
    previous: RunReport | None = None
    for r in reports:
        cells = [r.finished_at or str(r.run_id)]
        for g in gate_ids:
            gate = r.gates.get(g)
            if gate is None:
                cells.append("—")
                continue
            prev = previous.gates.get(g) if previous else None
            arrow = ""
            if prev is not None and gate.rate != prev.rate:
                arrow = " ↑" if gate.rate > prev.rate else " ↓"
            cells.append(f"{gate.rate * 100:5.1f}%{arrow}")
        cells.append(f"${r.cost_usd:.2f}")
        cells.append(f"{r.median_latency_ms / 1000:.1f}s")
        rows.append(cells)
        previous = r

    widths = [
        max(len(header[i]), *(len(row[i]) for row in rows))
        for i in range(len(header))
    ]
    line = "  ".join(h.ljust(widths[i]) for i, h in enumerate(header))
    out = [line, "-" * len(line)]
    out += ["  ".join(c.ljust(widths[i]) for i, c in enumerate(row)) for row in rows]
    return "\n".join(out)


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--repo",
        default=os.environ.get("GITHUB_REPOSITORY", ""),
        help="owner/name (default: $GITHUB_REPOSITORY)",
    )
    parser.add_argument("--runs", type=int, default=12, help="how many recent runs")
    args = parser.parse_args()

    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
    if not token or not args.repo:
        print(
            "Set GITHUB_TOKEN (or GH_TOKEN) and --repo/GITHUB_REPOSITORY.",
            file=sys.stderr,
        )
        return 2

    listing = await fetch_json(
        f"{API}/repos/{args.repo}/actions/workflows/{WORKFLOW}/runs"
        f"?status=completed&per_page={args.runs}",
        token,
    )
    runs = list(listing.get("workflow_runs", []))

    gate = asyncio.Semaphore(FETCH_CONCURRENCY)
    results = await asyncio.gather(
        *(report_for_run(args.repo, run, token, gate) for run in runs)
    )
    reports = sorted(
        (r for r in results if r is not None), key=lambda r: r.run_id
    )

    print(render(reports))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
