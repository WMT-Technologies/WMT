# PR #1: verified identity and workspace isolation

This patch replaces `x-user-id` trust with a Supabase Auth bearer token verified
against `/auth/v1/user` on EVERY request. The requested `x-workspace-id` is only a
selector; it grants no access by itself. User IDs, approval and roles must never
come from request bodies, `user_metadata`, signup fields, or decoded JWT claims.

## Required host integration (not present in this repository)

The PR contains a standalone module, not WMT's login or Super Admin implementation.
The following server-managed metadata contract is NEW; it is not an assertion
that existing WMT production users already have these fields:

```json
{
  "app_metadata": {
    "wmt": {
      "approval_status": "approved",
      "workspaces": {
        "example-workspace": { "status": "active", "role": "FINANCE" }
      }
    }
  }
}
```

Only the trusted Super Admin backend may provision/update this data using the
Auth Admin API. It must derive memberships from WMT's authoritative company
records, verify Super Admin authority, and propagate revocations to this contract
before reporting them complete. Do not copy arbitrary signup metadata here.
Pending, suspended, missing, invalid or unconfigured memberships fail closed.
`ADMIN` is workspace-scoped; it is not Super Admin and cannot approve registrations.
No users are automatically approved by this patch. If production uses another
identity provider, replace `requireAuth` with its verified session + authoritative
membership adapter before enabling the module; do not fall back to headers.

Pass `workspaceId` and `getAccessToken` to FileUpload and AnalysisPreview instead
of `userId`. Example with the host application's Supabase browser client:

```tsx
const getAccessToken = async () => {
  const { data, error } = await supabase.auth.getSession();
  return error ? null : data.session?.access_token ?? null;
};
<FileUpload workspaceId={selectedWorkspaceId} getAccessToken={getAccessToken} />
```

Browser session retrieval only obtains a credential. The API independently
verifies it; it never trusts the browser's session object. Keep credentials out
of URLs and logs. Requests use explicit bearer headers, not implicit cookies.

## Database and storage rollout

1. Apply `database/schema.sql` in staging first, then verify role grants and RLS.
   It closes direct anon/authenticated access to module tables and its bucket;
   server APIs verify current Auth metadata before using the private service client.
2. Existing analyses get a NULL workspace and remain inaccessible. Independently
   verify ownership before assigning companies and migrating old file paths.
   No automatic backfill is safe. New/updated rows must have a workspace.
3. File paths are `workspaceId/userId/randomUUID`, with no client-controlled filename.
   The bucket is private. Preview links expire after 60 seconds and are not persisted.
   A signed link remains a bearer capability until expiry; do not share it.
4. WMT `/ai-analysis/save` must consume the verified top-level `workspaceId` and
   `userId`, scope all destination records and related resource lookups to that
   workspace, and never override identity from `data`. Its implementation is absent
   here and must be contract-tested before deployment. The module passes both IDs.
5. Deploy host UI/API changes together after the schema and approval integration.
   Membership removal is checked on subsequent requests; already-authorized
   in-flight operations and issued short-lived preview URLs are not retroactively cancelled.

## Verification

Requires Node 24+ for the dependency-free security regression harness:

```sh
node --experimental-vm-modules --test tests/security.test.mjs
```

The harness runs real auth, route and repository code with isolated Auth,
Supabase and AI test doubles. It covers rejected/spoofed sessions, revoked and
wrong-workspace memberships, user/company-scoped database access, and file paths.
It does not prove production Auth configuration, deployed database policies, multipart
routing, OpenAI compatibility, or WMT backend behavior. Before deployment, also
verify that anon and authenticated clients cannot directly access these tables
or bucket, that legacy NULL-workspace rows are inaccessible, and that two real
staging workspaces cannot read or save each other's analyses.

Other review blockers (routing/multipart, OpenAI, PDF/Excel, false save success,
idempotency, data validation and tracked environment configuration) remain separate.

Database policy regression test (Postgres via pinned PGlite, isolated from production):

```sh
npm install --prefix /tmp/wmt-policy-test --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.3.14
WMT_TEST_PGLITE_MODULE=/tmp/wmt-policy-test/node_modules/@electric-sql/pglite/dist/index.js node --test tests/schema.test.mjs
```

This executes the actual schema twice against a minimal Storage schema with an
existing permissive policy and legacy rows, checks denied direct table and file
access, confirms unrelated buckets are unaffected, and tests a service-role write.
It does not replace verification on the target Supabase project.
