import OpenAI from 'openai';
import type { DocumentType, SuggestedAction, OpenAIAnalysisResponse } from '../types/analysis';

const DEFAULT_MODEL = 'gpt-5';
const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
const FILE_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export function isSupportedAnalysisMimeType(mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType);
  return IMAGE_MIME_TYPES.has(normalized) || FILE_MIME_TYPES.has(normalized);
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.toLowerCase().split(';', 1)[0].trim();
}

function safeFilename(filename: string | undefined, mimeType: string): string {
  const base = (filename || 'document')
    .split(/[\\/]/)
    .pop()
    ?.replace(/[^A-Za-z0-9._ -]/g, '_')
    .slice(0, 180) || 'document';

  if (/\.[A-Za-z0-9]{1,8}$/.test(base)) return base;

  const extension: Record<string, string> = {
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-excel': '.xls',
    'text/csv': '.csv',
    'application/csv': '.csv',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  };

  return `${base}${extension[mimeType] || ''}`;
}

function createClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  return new OpenAI({ apiKey });
}

/**
 * Analyze supported images and documents through the OpenAI Responses API.
 * Images are sent as input_image data URLs. PDF/Excel/Word/CSV are sent as
 * input_file base64 content with a filename so the API can process the file.
 */
export async function analyzeWithVision(
  fileBuffer: Buffer,
  mimeType: string,
  documentTypeHint?: string,
  filename?: string
): Promise<OpenAIAnalysisResponse> {
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (!isSupportedAnalysisMimeType(normalizedMimeType)) {
    throw new Error(`Unsupported analysis file type: ${normalizedMimeType || 'unknown'}`);
  }
  if (!fileBuffer?.length) {
    throw new Error('Cannot analyze an empty file');
  }

  const base64 = fileBuffer.toString('base64');
  const content: Array<Record<string, unknown>> = [
    {
      type: 'input_text',
      text: buildSystemPrompt(documentTypeHint),
    },
  ];

  if (IMAGE_MIME_TYPES.has(normalizedMimeType)) {
    content.push({
      type: 'input_image',
      image_url: `data:${normalizedMimeType};base64,${base64}`,
      detail: 'auto',
    });
  } else {
    content.push({
      type: 'input_file',
      filename: safeFilename(filename, normalizedMimeType),
      file_data: `data:${normalizedMimeType};base64,${base64}`,
    });
  }

  const client = createClient();
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    max_output_tokens: 1200,
    input: [
      {
        role: 'user',
        content: content as any,
      },
    ],
  });

  const responseText = response.output_text?.trim() || '';
  if (!responseText) {
    throw new Error('OpenAI returned an empty analysis response');
  }

  return parseVisionResponse(responseText);
}

function buildSystemPrompt(documentTypeHint?: string): string {
  const typeHint = documentTypeHint ? `The document might be: ${documentTypeHint}.` : '';

  return `You are an expert business document and image analysis AI. ${typeHint}

Analyze the supplied file and:
1. Identify the document type (employee_document, receipt, invoice, customer_inquiry, site_photo, transaction_screenshot, contract, expense_report, or unknown).
2. Extract all relevant structured data from every relevant page/sheet.
3. Provide a confidence score from 0 to 1.
4. Suggest exactly one supported action: create_employee_profile, update_employee_data, create_expense_record, create_crm_inquiry, create_quotation, create_project_document, create_transaction, create_invoice, or skip.
5. For spreadsheets, inspect all available sheets represented by the file and preserve sheet/row context where useful.

Return ONLY valid JSON, with no markdown:
{
  "type": "document_type",
  "confidence": 0.95,
  "data": {
    "field1": "value1",
    "field2": "value2"
  },
  "action": "suggested_action",
  "summary": "Brief description of what was found"
}

Extract these fields when applicable:
- Employee documents: name, idNumber, expiryDate, nationality, department, position
- Receipts/invoices: vendor, invoiceNumber, date, dueDate, amount, items, taxAmount, paymentMethod
- Transactions: amount, date, account, transactionType, description, referenceNumber
- Customer inquiries: contactName, product, issue, contactEmail, phone
- Site/project files: location, date, description, hazards, workInProgress
Do not invent missing values.`;
}

function parseVisionResponse(responseText: string): OpenAIAnalysisResponse {
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');

    const parsed = JSON.parse(jsonMatch[0]);
    const confidence = Number(parsed.confidence);

    return {
      type: (parsed.type as DocumentType) || 'unknown',
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
      data: parsed.data && typeof parsed.data === 'object' ? parsed.data : {},
      action: (parsed.action as SuggestedAction) || 'skip',
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    };
  } catch (error) {
    console.error('Error parsing OpenAI response:', error);
    throw new Error('Failed to parse AI response');
  }
}

function shouldRetry(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  if (
    error.message.includes('OPENAI_API_KEY') ||
    error.message.startsWith('Unsupported analysis file type') ||
    error.message.includes('empty file') ||
    error.message.includes('Failed to parse AI response')
  ) {
    return false;
  }

  const status = (error as Error & { status?: number }).status;
  if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return false;
  }
  return true;
}

export async function analyzeWithRetry(
  fileBuffer: Buffer,
  mimeType: string,
  documentTypeHint?: string,
  filename?: string,
  maxRetries: number = 3
): Promise<OpenAIAnalysisResponse> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await analyzeWithVision(fileBuffer, mimeType, documentTypeHint, filename);
    } catch (error) {
      if (attempt === maxRetries - 1 || !shouldRetry(error)) throw error;
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`Retrying OpenAI in ${delay}ms... (attempt ${attempt + 1})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error('Max retries exceeded');
}
