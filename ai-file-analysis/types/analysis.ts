// Analysis Types

export interface AnalysisRequest {
  userId: string;
  workspaceId: string;
  file: File;
  documentType?: string;
}

export interface ExtractedData {
  [key: string]: string | number | boolean | null | unknown[] | Record<string, unknown>;
}

export interface AnalysisResult {
  id: string;
  detectedType: DocumentType;
  confidence: number;
  extractedData: ExtractedData;
  suggestedAction: SuggestedAction;
  requiresApproval: boolean;
  fileUrl: string;
  fileStoragePath: string;
  analysisMetadata: AnalysisMetadata;
  rawAiResponse?: string;
}

export interface AnalysisMetadata {
  uploadedAt: string;
  userId: string;
  workspaceId: string;
  analysisTime: number;
  aiProvider: 'openai_responses' | 'google_document_ai' | 'hybrid';
  fileSize: number;
  fileMimeType: string;
}

export type DocumentType =
  | 'employee_document'
  | 'receipt'
  | 'invoice'
  | 'customer_inquiry'
  | 'site_photo'
  | 'transaction_screenshot'
  | 'contract'
  | 'expense_report'
  | 'unknown';

export type SuggestedAction =
  | 'create_employee_profile'
  | 'update_employee_data'
  | 'create_expense_record'
  | 'create_crm_inquiry'
  | 'create_quotation'
  | 'create_project_document'
  | 'create_transaction'
  | 'create_invoice'
  | 'skip';

export interface SaveAnalysisRequest {
  analysisId: string;
  userId: string;
  workspaceId: string;
  approvedData: ExtractedData;
  notes?: string;
}

export interface SaveAnalysisResponse {
  success: boolean;
  recordId?: string;
  message: string;
  savedAt?: string;
}

export interface ApiError {
  error: string;
  code: string;
  details?: string;
}

export type UserRole = 'SALES' | 'HR' | 'FINANCE' | 'PROJECT' | 'ADMIN';

export interface UserPermissions {
  userId: string;
  workspaceId: string;
  role: UserRole;
  permissions: SuggestedAction[];
}

export interface OpenAIAnalysisResponse {
  type: DocumentType;
  confidence: number;
  data: ExtractedData;
  action: SuggestedAction;
  summary: string;
}
