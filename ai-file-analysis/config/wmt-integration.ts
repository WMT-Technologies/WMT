/**
 * WMT Backend Integration Configuration
 * Maps AI analysis results to WMT API endpoints
 */

export interface WMTApiConfig {
  baseUrl: string;
  apiKey: string;
  timeout: number;
  retryAttempts: number;
  retryDelayMs: number;
}

export interface WMTEndpointMap {
  [action: string]: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    endpoint: string;
    dataTransform: (data: Record<string, any>) => Record<string, any>;
  };
}

/**
 * WMT API Configuration
 */
export const wmtApiConfig: WMTApiConfig = {
  baseUrl: process.env.NEXT_PUBLIC_WMT_API_URL || 'https://api.wmt.com',
  apiKey: process.env.WMT_API_KEY || '',
  timeout: 30000,
  retryAttempts: 3,
  retryDelayMs: 1000,
};

/**
 * Endpoint mapping for different actions
 */
export const wmtEndpointMap: WMTEndpointMap = {
  // HR Module
  create_employee_profile: {
    method: 'POST',
    endpoint: '/api/v1/hr/employees',
    dataTransform: (data) => ({
      firstName: data.name?.split(' ')[0] || '',
      lastName: data.name?.split(' ').slice(1).join(' ') || '',
      employeeId: data.idNumber,
      nationality: data.nationality,
      department: data.department,
      position: data.position,
      dateOfBirth: data.dateOfBirth,
      documentExpiry: data.expiryDate,
    }),
  },

  update_employee_data: {
    method: 'PATCH',
    endpoint: '/api/v1/hr/employees/:id',
    dataTransform: (data) => ({
      documentExpiry: data.expiryDate,
      nationality: data.nationality,
      department: data.department,
      position: data.position,
    }),
  },

  // Finance Module
  create_expense_record: {
    method: 'POST',
    endpoint: '/api/v1/finance/expenses',
    dataTransform: (data) => ({
      vendor: data.vendor,
      amount: parseFloat(data.amount),
      date: data.date,
      category: data.category || 'Other',
      items: data.items || [],
      taxAmount: parseFloat(data.taxAmount || 0),
      paymentMethod: data.paymentMethod,
      receiptNumber: data.receiptNumber,
      description: data.description,
      notes: data.notes,
    }),
  },

  create_transaction: {
    method: 'POST',
    endpoint: '/api/v1/finance/transactions',
    dataTransform: (data) => ({
      amount: parseFloat(data.amount),
      date: data.date,
      account: data.account,
      type: data.transactionType,
      description: data.description,
      referenceNumber: data.referenceNumber,
      status: data.status || 'completed',
    }),
  },

  create_invoice: {
    method: 'POST',
    endpoint: '/api/v1/finance/invoices',
    dataTransform: (data) => ({
      vendor: data.vendor,
      invoiceNumber: data.invoiceNumber,
      date: data.date,
      dueDate: data.dueDate,
      amount: parseFloat(data.amount),
      items: data.items || [],
      taxAmount: parseFloat(data.taxAmount || 0),
      purchaseOrder: data.purchaseOrder,
      vendorContact: data.vendorContact,
      notes: data.notes,
    }),
  },

  // Sales Module
  create_crm_inquiry: {
    method: 'POST',
    endpoint: '/api/v1/sales/inquiries',
    dataTransform: (data) => ({
      contactName: data.contactName,
      email: data.contactEmail,
      phone: data.phone,
      product: data.product,
      issue: data.issue,
      description: data.description,
      location: data.location,
      priority: 'medium',
      status: 'new',
    }),
  },

  create_quotation: {
    method: 'POST',
    endpoint: '/api/v1/sales/quotations',
    dataTransform: (data) => ({
      contactName: data.contactName,
      email: data.contactEmail,
      phone: data.phone,
      product: data.product,
      description: data.description,
      estimatedAmount: parseFloat(data.amount || 0),
      validUntil: data.validUntil,
    }),
  },

  // Project Module
  create_project_document: {
    method: 'POST',
    endpoint: '/api/v1/projects/documents',
    dataTransform: (data) => ({
      title: data.description || 'Site Photo',
      location: data.location,
      documentDate: data.date,
      documentType: 'site_photo',
      description: data.description,
      tags: [
        data.hazards ? 'hazards' : '',
        data.workInProgress ? 'work_in_progress' : '',
      ].filter(Boolean),
      metadata: {
        weather: data.weather,
        equipmentPresent: data.equipmentPresent,
      },
    }),
  },
};

/**
 * Fetch data from WMT API with retry logic
 */
export async function fetchFromWMT(
  endpoint: string,
  method: string = 'GET',
  body?: Record<string, any>
): Promise<any> {
  const url = `${wmtApiConfig.baseUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${wmtApiConfig.apiKey}`,
  };

  const options: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(wmtApiConfig.timeout),
  };

  if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
    options.body = JSON.stringify(body);
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < wmtApiConfig.retryAttempts; attempt++) {
    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        throw new Error(`WMT API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error as Error;

      if (attempt < wmtApiConfig.retryAttempts - 1) {
        const delay = wmtApiConfig.retryDelayMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('WMT API request failed');
}

/**
 * Save analysis result to appropriate WMT endpoint
 */
export async function saveToWMTEndpoint(
  action: string,
  analysisData: Record<string, any>
): Promise<{ id: string; [key: string]: any }> {
  const endpointConfig = wmtEndpointMap[action];

  if (!endpointConfig) {
    throw new Error(`No WMT endpoint mapped for action: ${action}`);
  }

  const transformedData = endpointConfig.dataTransform(analysisData);
  const response = await fetchFromWMT(
    endpointConfig.endpoint,
    endpointConfig.method,
    transformedData
  );

  return response;
}

/**
 * Get user from WMT
 */
export async function getWMTUser(userId: string): Promise<any> {
  return fetchFromWMT(`/api/v1/users/${userId}`, 'GET');
}

/**
 * Get user role and permissions from WMT
 */
export async function getWMTUserRole(userId: string): Promise<string> {
  try {
    const user = await getWMTUser(userId);
    return user.role || 'USER';
  } catch (error) {
    console.error('Failed to get user role:', error);
    return 'USER';
  }
}

/**
 * Validate user has permission for action
 */
export async function validateWMTPermission(
  userId: string,
  action: string,
  resource?: string
): Promise<boolean> {
  try {
    const response = await fetchFromWMT(
      `/api/v1/users/${userId}/permissions?action=${action}&resource=${resource || '*'}`,
      'GET'
    );
    return response.allowed === true;
  } catch (error) {
    console.error('Failed to validate permission:', error);
    return false;
  }
}
