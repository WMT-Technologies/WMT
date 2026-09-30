import type { UserRole } from '../types/analysis';

export interface AuthContext {
  readonly userId: string;
  readonly workspaceId: string;
  readonly role: UserRole;
}

export class AccessError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const roles = new Set<UserRole>(['SALES', 'HR', 'FINANCE', 'PROJECT', 'ADMIN']);
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const userIdentifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Verify with Auth on every request: never trust user IDs or roles from the client.
 * app_metadata.wmt is a NEW integration contract; see AUTH_INTEGRATION.md.
 * It must be maintained by the trusted Super Admin backend, never signup input.
 */
export async function requireAuth(
  req: { headers: Record<string, string | string[] | undefined> }
): Promise<AuthContext> {
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string' || !/^Bearer [^\s,]+$/i.test(authorization)) {
    throw new AccessError(401, 'UNAUTHENTICATED', 'A valid session is required');
  }
  const workspaceId = req.headers['x-workspace-id'];
  if (typeof workspaceId !== 'string' || !identifier.test(workspaceId)) {
    throw new AccessError(400, 'INVALID_WORKSPACE', 'A valid workspace is required');
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new AccessError(503, 'AUTH_UNAVAILABLE', 'Authentication is unavailable');
  }
  let response: Response;
  try {
    response = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: key, Authorization: authorization },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new AccessError(503, 'AUTH_UNAVAILABLE', 'Authentication is unavailable');
  }
  if (response.status === 401 || response.status === 403) {
    throw new AccessError(401, 'UNAUTHENTICATED', 'Session is invalid or expired');
  }
  if (!response.ok) {
    throw new AccessError(503, 'AUTH_UNAVAILABLE', 'Authentication is unavailable');
  }
  let user;
  try {
    user = await response.json();
  } catch {
    throw new AccessError(503, 'AUTH_UNAVAILABLE', 'Authentication is unavailable');
  }
  if (!user || typeof user.id !== 'string' || !userIdentifier.test(user.id) || user.is_anonymous === true) {
    throw new AccessError(401, 'UNAUTHENTICATED', 'A registered user session is required');
  }
  // Read current server-managed metadata from Auth, NOT decoded JWT/user_metadata.
  const access = user.app_metadata?.wmt;
  const memberships = access?.workspaces;
  const membership = memberships && Object.prototype.hasOwnProperty.call(memberships, workspaceId)
    ? memberships[workspaceId] : undefined;
  if (access?.approval_status !== 'approved' || membership?.status !== 'active' || !roles.has(membership?.role)) {
    throw new AccessError(403, 'WORKSPACE_ACCESS_DENIED', 'Approved workspace membership is required');
  }
  return Object.freeze({ userId: user.id, workspaceId, role: membership.role });
}

export function assertOwnedPath(context: AuthContext, path: string): void {
  const prefix = `${context.workspaceId}/${context.userId}/`;
  if (!path.startsWith(prefix) || path.split('/').length !== 3 || !identifier.test(path.slice(prefix.length))) {
    throw new AccessError(403, 'FILE_ACCESS_DENIED', 'File does not belong to this workspace and user');
  }
}
