# B01 correction prompt — relay to the implementing model

Reviewer decision: CHANGES REQUIRED. B02 is not authorized.

Read docs/engineering/typescript-migration/evidence/B01-independent-review.md and implement R1/R2 only. Continue obeying AGENTS.md and the migration plan. Proceed with these reversible local corrections without requesting another confirmation.

The reviewer independently reran the current pilot and product checks successfully. However, isolated copies of your runner still reported OK 3/3 when DOM was added, strictNullChecks/noImplicitAny were explicitly disabled, or the production @ts-check directive was removed. Fix those false passes.

R1: strengthen scripts/typecheck-pilot.mjs to enforce exact effective environment options, explicit types:[], all relevant strict sub-options, genuine standard-lib provenance, and actual checking of the production JS in every program. The review supplies the exact options and pinned-compiler checks. Keep existing positive and exact negative-diagnostic assertions. Add narrow guard-regression checks using isolated copies or in-memory programs; verify the intended guard failure, not just any nonzero exit. Wrong target/module/resolution, added DOM, omitted types, disabled strict sub-options, and absent/disabled @ts-check must be rejected. Baseline must still pass.

R2: correct evidence claims about retained pre-edit snapshots/full status and logs. Do not fabricate historical evidence. Replace rollback instructions involving HEAD or deleting broad parent folders with removal of exact B01 edits/files, preserving all prior and later unrelated work and the original plan/prompt. State any remaining historical preservation-verification limits honestly.

Editable scope is listed in the review. No new source coverage, runtime statement changes, renames, dependency upgrades, database actions, or B02 work. Preserve all unrelated working-tree edits. For these corrections, first retain actual pre-edit snapshots/hashes and full status, excluding secrets.

Run node --check for changed helpers, both npm pilot checks, your guard-regression command, workspace:check, test:products, test:release-architecture, and products:list. Inspect side effects first. Preserve original fixture sabotage coverage. Correct/restored files must pass final checks. Full product builds need repeating only if changes touch their inputs or another new concern warrants it; do not claim the reviewer independently ran them.

Write the revised completion/self-review packet with each guard case and exit code, actual evidence paths, correction-only changes, historical evidence limitations, and precise rollback. Leave reviewer status PENDING RE-REVIEW and stop. Do not edit the independent review to claim acceptance.
