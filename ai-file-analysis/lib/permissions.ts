import { UserRole, SuggestedAction } from '../types/analysis';

// Role-to-Permissions mapping
const rolePermissions: Record<UserRole, SuggestedAction[]> = {
  SALES: [
    'create_crm_inquiry',
    'create_quotation',
  ],
  HR: [
    'create_employee_profile',
    'update_employee_data',
  ],
  FINANCE: [
    'create_expense_record',
    'create_transaction',
    'create_invoice',
  ],
  PROJECT: [
    'create_project_document',
  ],
  ADMIN: [
    'create_employee_profile',
    'update_employee_data',
    'create_expense_record',
    'create_crm_inquiry',
    'create_quotation',
    'create_project_document',
    'create_transaction',
    'create_invoice',
    'skip',
  ],
};

/**
 * Check if user has permission for a specific action
 */
export function hasPermission(
  userRole: UserRole,
  action: SuggestedAction
): boolean {
  const permissions = rolePermissions[userRole] || [];
  return permissions.includes(action);
}

/**
 * Get all permissions for a user role
 */
export function getUserPermissions(userRole: UserRole): SuggestedAction[] {
  return rolePermissions[userRole] || [];
}

/**
 * Get user role from WMT database or JWT token
 */
export async function getUserRole(userId: string): Promise<UserRole> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_WMT_API_URL}/users/${userId}`, {
      headers: {
        Authorization: `Bearer ${process.env.WMT_API_KEY}`,
      },
    });

    if (!response.ok) {
      console.warn(`Failed to fetch user role for ${userId}`);
      return 'SALES';
    }

    const user = await response.json();
    return user.role || 'SALES';
  } catch (error) {
    console.error('Error fetching user role:', error);
    return 'SALES';
  }
}

/**
 * Validate user can perform action based on their role
 */
export async function validateUserPermission(
  userId: string,
  action: SuggestedAction
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const userRole = await getUserRole(userId);

    if (!hasPermission(userRole, action)) {
      return {
        allowed: false,
        reason: `User role '${userRole}' does not have permission for action '${action}'`,
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error('Error validating permission:', error);
    return {
      allowed: false,
      reason: 'Error validating permissions',
    };
  }
}

/**
 * Document type to allowed roles mapping
 */
const documentTypeRoles: Record<string, UserRole[]> = {
  employee_document: ['HR', 'ADMIN'],
  receipt: ['FINANCE', 'ADMIN'],
  invoice: ['FINANCE', 'ADMIN'],
  customer_inquiry: ['SALES', 'ADMIN'],
  site_photo: ['PROJECT', 'ADMIN'],
  transaction_screenshot: ['FINANCE', 'ADMIN'],
  contract: ['ADMIN'],
  expense_report: ['FINANCE', 'ADMIN'],
};

/**
 * Check if user's role can handle a specific document type
 */
export function canHandleDocumentType(
  userRole: UserRole,
  documentType: string
): boolean {
  const allowedRoles = documentTypeRoles[documentType] || [];
  return allowedRoles.includes(userRole);
}

/**
 * Audit log for analysis and save operations
 */
export async function logAnalysisAction(
  userId: string,
  action: string,
  analysisId: string,
  details: Record<string, any>
): Promise<void> {
  try {
    console.log({
      timestamp: new Date().toISOString(),
      userId,
      action,
      analysisId,
      ...details,
    });

    if (process.env.AUDIT_LOG_ENDPOINT) {
      await fetch(process.env.AUDIT_LOG_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          userId,
          action,
          analysisId,
          ...details,
        }),
      }).catch(err => console.error('Failed to log to audit service:', err));
    }
  } catch (error) {
    console.error('Error logging analysis action:', error);
  }
}
