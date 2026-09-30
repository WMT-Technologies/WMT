import { DocumentType, SuggestedAction } from '../types/analysis';

export interface DocumentTypeConfig {
  type: DocumentType;
  name: string;
  description: string;
  roles: string[];
  suggestedAction: SuggestedAction;
  fieldsToExtract: string[];
  validationRules: Record<string, any>;
  wcagCompliance?: {
    acceptedFormats: string[];
    maxFileSize: number;
    minConfidenaceThreshold: number;
  };
}

export const documentTypeConfigs: Record<DocumentType, DocumentTypeConfig> = {
  employee_document: {
    type: 'employee_document',
    name: 'Employee Document (ID/Passport)',
    description: 'Employee identification documents, passports, visas',
    roles: ['HR', 'ADMIN'],
    suggestedAction: 'create_employee_profile',
    fieldsToExtract: [
      'name',
      'idNumber',
      'expiryDate',
      'nationality',
      'department',
      'position',
      'dateOfBirth',
      'issueDate',
    ],
    validationRules: {
      name: { type: 'string', required: true, minLength: 2 },
      idNumber: { type: 'string', required: true },
      expiryDate: { type: 'date', required: true },
      nationality: { type: 'string' },
    },
    wcagCompliance: {
      acceptedFormats: ['image/jpeg', 'image/png', 'application/pdf'],
      maxFileSize: 10 * 1024 * 1024,
      minConfidenaceThreshold: 0.8,
    },
  },

  receipt: {
    type: 'receipt',
    name: 'Receipt',
    description: 'Purchase receipts, payment receipts',
    roles: ['FINANCE', 'ADMIN'],
    suggestedAction: 'create_expense_record',
    fieldsToExtract: [
      'vendor',
      'date',
      'amount',
      'items',
      'taxAmount',
      'paymentMethod',
      'receiptNumber',
      'category',
    ],
    validationRules: {
      vendor: { type: 'string', required: true },
      date: { type: 'date', required: true },
      amount: { type: 'number', required: true, min: 0 },
    },
    wcagCompliance: {
      acceptedFormats: ['image/jpeg', 'image/png', 'application/pdf'],
      maxFileSize: 10 * 1024 * 1024,
      minConfidenaceThreshold: 0.75,
    },
  },

  invoice: {
    type: 'invoice',
    name: 'Invoice',
    description: 'Vendor invoices, billing documents',
    roles: ['FINANCE', 'ADMIN'],
    suggestedAction: 'create_invoice',
    fieldsToExtract: [
      'vendor',
      'invoiceNumber',
      'date',
      'dueDate',
      'amount',
      'items',
      'taxAmount',
      'purchaseOrder',
      'vendorContact',
    ],
    validationRules: {
      vendor: { type: 'string', required: true },
      invoiceNumber: { type: 'string', required: true },
      date: { type: 'date', required: true },
      amount: { type: 'number', required: true, min: 0 },
    },
    wcagCompliance: {
      acceptedFormats: ['image/jpeg', 'image/png', 'application/pdf'],
      maxFileSize: 20 * 1024 * 1024,
      minConfidenaceThreshold: 0.85,
    },
  },

  transaction_screenshot: {
    type: 'transaction_screenshot',
    name: 'Transaction Screenshot',
    description: 'Bank transactions, payment confirmations',
    roles: ['FINANCE', 'ADMIN'],
    suggestedAction: 'create_transaction',
    fieldsToExtract: [
      'amount',
      'date',
      'account',
      'transactionType',
      'description',
      'referenceNumber',
      'status',
    ],
    validationRules: {
      amount: { type: 'number', required: true },
      date: { type: 'date', required: true },
      account: { type: 'string' },
      transactionType: { type: 'string', required: true },
    },
    wcagCompliance: {
      acceptedFormats: ['image/jpeg', 'image/png'],
      maxFileSize: 10 * 1024 * 1024,
      minConfidenaceThreshold: 0.8,
    },
  },

  customer_inquiry: {
    type: 'customer_inquiry',
    name: 'Customer Inquiry Photo',
    description: 'Customer inquiry photos, product issues',
    roles: ['SALES', 'ADMIN'],
    suggestedAction: 'create_crm_inquiry',
    fieldsToExtract: [
      'contactName',
      'product',
      'issue',
      'contactEmail',
      'phone',
      'description',
      'location',
    ],
    validationRules: {
      contactName: { type: 'string' },
      product: { type: 'string' },
      issue: { type: 'string' },
    },
    wcagCompliance: {
      acceptedFormats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      maxFileSize: 15 * 1024 * 1024,
      minConfidenaceThreshold: 0.7,
    },
  },

  site_photo: {
    type: 'site_photo',
    name: 'Site Photo/Drawing',
    description: 'Construction site photos, project drawings',
    roles: ['PROJECT', 'ADMIN'],
    suggestedAction: 'create_project_document',
    fieldsToExtract: [
      'location',
      'date',
      'description',
      'hazards',
      'workInProgress',
      'weather',
      'equipmentPresent',
    ],
    validationRules: {
      location: { type: 'string' },
      date: { type: 'date' },
      description: { type: 'string' },
    },
    wcagCompliance: {
      acceptedFormats: ['image/jpeg', 'image/png', 'application/pdf'],
      maxFileSize: 20 * 1024 * 1024,
      minConfidenaceThreshold: 0.65,
    },
  },

  expense_report: {
    type: 'expense_report',
    name: 'Expense Report',
    description: 'Employee expense reports, reimbursement requests',
    roles: ['FINANCE', 'ADMIN'],
    suggestedAction: 'create_expense_record',
    fieldsToExtract: [
      'employeeName',
      'amount',
      'category',
      'description',
      'date',
      'department',
      'project',
      'notes',
    ],
    validationRules: {
      employeeName: { type: 'string', required: true },
      amount: { type: 'number', required: true, min: 0 },
      category: { type: 'string', required: true },
      date: { type: 'date', required: true },
    },
    wcagCompliance: {
      acceptedFormats: ['image/jpeg', 'image/png', 'application/pdf'],
      maxFileSize: 15 * 1024 * 1024,
      minConfidenaceThreshold: 0.8,
    },
  },

  contract: {
    type: 'contract',
    name: 'Contract/Agreement',
    description: 'Contracts, agreements, legal documents',
    roles: ['ADMIN'],
    suggestedAction: 'skip',
    fieldsToExtract: [
      'contractType',
      'parties',
      'date',
      'expiryDate',
      'amount',
      'summary',
    ],
    validationRules: {
      contractType: { type: 'string' },
      date: { type: 'date' },
    },
    wcagCompliance: {
      acceptedFormats: ['application/pdf', 'image/jpeg', 'image/png'],
      maxFileSize: 50 * 1024 * 1024,
      minConfidenaceThreshold: 0.7,
    },
  },

  unknown: {
    type: 'unknown',
    name: 'Unknown Document',
    description: 'Unable to classify document type',
    roles: [],
    suggestedAction: 'skip',
    fieldsToExtract: [],
    validationRules: {},
    wcagCompliance: {
      acceptedFormats: ['image/jpeg', 'image/png', 'application/pdf'],
      maxFileSize: 20 * 1024 * 1024,
      minConfidenaceThreshold: 0.0,
    },
  },
};

/**
 * Get configuration for a document type
 */
export function getDocumentTypeConfig(type: DocumentType): DocumentTypeConfig {
  return documentTypeConfigs[type] || documentTypeConfigs.unknown;
}

/**
 * Get all document types for a specific role
 */
export function getDocumentTypesForRole(role: string): DocumentTypeConfig[] {
  return Object.values(documentTypeConfigs).filter(config => config.roles.includes(role));
}

/**
 * Validate extracted data against document type rules
 */
export function validateExtractedData(
  type: DocumentType,
  data: Record<string, any>
): { valid: boolean; errors: string[] } {
  const config = getDocumentTypeConfig(type);
  const errors: string[] = [];

  Object.entries(config.validationRules).forEach(([field, rules]: [string, any]) => {
    const value = data[field];

    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push(`${field} is required`);
      return;
    }

    if (value !== undefined && value !== null) {
      if (rules.type === 'string' && typeof value !== 'string') {
        errors.push(`${field} must be a string`);
      }

      if (rules.type === 'number' && typeof value !== 'number') {
        errors.push(`${field} must be a number`);
      }

      if (rules.type === 'date') {
        const date = new Date(value);
        if (isNaN(date.getTime())) {
          errors.push(`${field} must be a valid date`);
        }
      }

      if (rules.minLength && String(value).length < rules.minLength) {
        errors.push(`${field} must be at least ${rules.minLength} characters`);
      }

      if (rules.min !== undefined && value < rules.min) {
        errors.push(`${field} must be at least ${rules.min}`);
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}
"