/**
 * Pure catalog-publication sweep (no Electron): claim with token+lease,
 * publish the derived snapshot, complete with token+unexpired lease.
 * Snapshots are derived from live catalog tables, never applied from job
 * payloads, so an older job publishing late cannot regress a newer catalog;
 * claiming still prefers the newest pending version and supersedes older
 * pending rows to avoid wasted work.
 *
 * Every outlet reports its own status: published | pending | failed |
 * no-job. An empty sweep is NOT publication proof — callers expecting jobs
 * must keep those outlets pending.
 */

/**
 * @param {object} deps
 * @param {string[]} deps.outlets
 * @param {(outletId: string) => Promise<object|null>} deps.claim - null when nothing claimable
 * @param {(outletId: string, job: object) => Promise<void>} deps.publish - throws on failure
 * @param {(job: object) => Promise<{ completed: boolean; superseded?: boolean; error?: string }>} deps.complete
 * @param {(job: object, error: string, permanent: boolean) => Promise<void>} deps.release
 * @param {number} [deps.maxAttempts]
 */
export async function runPublicationSweep(deps) {
  const outlets = [...new Set((Array.isArray(deps?.outlets) ? deps.outlets : []).filter(Boolean))];
  const maxAttempts = Number.isFinite(Number(deps?.maxAttempts)) ? Number(deps.maxAttempts) : 5;
  const results = [];
  for (const outletId of outlets) {
    let claimed = null;
    try {
      claimed = await deps.claim(outletId);
    } catch (error) {
      results.push({ outlet_id: outletId, status: "pending", error: error?.message || "Claim failed" });
      continue;
    }
    if (!claimed?.job) {
      results.push({ outlet_id: outletId, status: "no-job" });
      continue;
    }
    const job = claimed.job;
    if (Number(job.attempts || 0) > maxAttempts) {
      try {
        await deps.release(job, "Too many publication attempts; held for manager review.", true);
      } catch {
        /* Lease expiry remains the backstop. */
      }
      results.push({
        outlet_id: outletId,
        status: "failed",
        job_id: job.job_id || null,
        attempts: Number(job.attempts || 0),
        error: "Too many publication attempts; held for manager review.",
      });
      continue;
    }
    try {
      await deps.publish(outletId, job);
    } catch (error) {
      try {
        await deps.release(job, error?.message || "Publication failed", false);
      } catch {
        /* Lease expiry remains the backstop. */
      }
      results.push({ outlet_id: outletId, status: "pending", job_id: job.job_id || null, error: error?.message || "Publication failed" });
      continue;
    }
    try {
      const done = await deps.complete(job);
      if (done?.superseded) {
        results.push({ outlet_id: outletId, status: "published", job_id: job.job_id || null, note: "A newer catalog already covers this outlet." });
      } else if (done?.completed) {
        results.push({ outlet_id: outletId, status: "published", job_id: job.job_id || null });
      } else {
        results.push({ outlet_id: outletId, status: "pending", job_id: job.job_id || null, error: done?.error || "Completion rejected" });
      }
    } catch (error) {
      results.push({ outlet_id: outletId, status: "pending", job_id: job.job_id || null, error: error?.message || "Completion failed" });
    }
  }
  return results;
}

/**
 * Map sweep results onto an expected outlet set: outlets with no published
 * result stay pending. Never translate an empty sweep into "published".
 */
export function summarizePublication(expectedOutlets, results) {
  const byOutlet = new Map((Array.isArray(results) ? results : []).map((row) => [row?.outlet_id, row]));
  return (Array.isArray(expectedOutlets) ? expectedOutlets : []).filter(Boolean).map((outletId) => {
    const row = byOutlet.get(outletId);
    if (row?.status === "published") return { outlet_id: outletId, status: "published", job_id: row.job_id || null };
    if (row?.status === "failed") return { outlet_id: outletId, status: "failed", job_id: row.job_id || null, error: row.error || null };
    return { outlet_id: outletId, status: "pending", job_id: row?.job_id || null, error: row?.error || null };
  });
}
