// A checkout's identity is separate from the event, workflow definition and resolved target. Consumers retain the
// historical top-level sha/ref fields, using the event only when the caller did not record an actual checkout.
export function runProvenance(env) {
    const provenance = {
        event: { sha: env.GITHUB_SHA || null, ref: env.GITHUB_REF_NAME || null },
        workflow: { sha: env.GITHUB_WORKFLOW_SHA || null, ref: env.GITHUB_WORKFLOW_REF || null },
        resolved: { sha: env.RESOLVED_SHA || null, ref: env.RESOLVED_REF || null },
        checkout: { sha: env.TESTED_SHA || null, ref: env.TESTED_REF || null },
    };
    return {
        sha: provenance.checkout.sha ?? provenance.event.sha,
        // A triggering branch's ref says nothing about another checked-out commit.
        ref: provenance.checkout.sha ? provenance.checkout.ref : provenance.event.ref,
        provenance,
    };
}
