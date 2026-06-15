import OpenAI from 'openai';
import { DocumentType, SuggestedAction, OpenAIAnalysisResponse } from '../types/analysis';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Analyze image/file using OpenAI Vision API
 */
export async function analyzeWithVision(
  fileBuffer: Buffer,
  mimeType: string,
  documentTypeHint?: string
): Promise<OpenAIAnalysisResponse> {
  try {
    // Convert buffer to base64
    const base64Image = fileBuffer.toString('base64');

    // Determine if image or other format
    if (!mimeType.startsWith('image/')) {
      throw new Error(
        'OpenAI Vision API only supports images. For PDFs/documents, use Google Document AI.'
      );
    }

    // Build system prompt
    const systemPrompt = buildSystemPrompt(documentTypeHint);

    // Call OpenAI Vision API
    const message = await openai.messages.create({
      model: 'gpt-4-vision-preview',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: systemPrompt,
            },
          ],
        },
      ],
    });

    // Parse response
    const responseText =
      message.content[0].type === 'text' ? message.content[0].text : '';
    const parsed = parseVisionResponse(responseText);

    return parsed;
  } catch (error) {
    console.error('Error analyzing with OpenAI Vision:', error);
    throw error;
  }
}

/**
 * Build system prompt for document analysis
 */
function buildSystemPrompt(documentTypeHint?: string): string {
  const typeHint = documentTypeHint ? `The document might be: ${documentTypeHint}.` : '';

  return `You are an expert document and image analysis AI. ${typeHint}

Analyze the image and:
1. Identify the document type (employee_document, receipt, invoice, customer_inquiry, site_photo, transaction_screenshot, contract, expense_report, or unknown)
2. Extract all relevant structured data
3. Provide confidence score (0-1)
4. Suggest what action to take (create_employee_profile, create_expense_record, create_crm_inquiry, etc.)

Return your response ONLY as valid JSON (no markdown, no explanations):
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
- For employee documents: name, idNumber, expiryDate, nationality, department, position
- For receipts/invoices: vendor, date, amount, items, taxAmount, paymentMethod
- For transactions: amount, date, account, transactionType, description
- For customer inquiries: contactName, product, issue, contactEmail, phone
- For site photos: location, date, description, hazards, workInProgress`;
}

/**
 * Parse OpenAI Vision API response
 */
function parseVisionResponse(responseText: string): OpenAIAnalysisResponse {
  try {
    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      type: (parsed.type as DocumentType) || 'unknown',
      confidence: parseFloat(parsed.confidence) || 0.5,
      data: parsed.data || {},
      action: (parsed.action as SuggestedAction) || 'skip',
      summary: parsed.summary || '',
    };
  } catch (error) {
    console.error('Error parsing Vision response:', error);
    throw new Error('Failed to parse AI response');
  }
}

/**
 * Retry analysis with exponential backoff
 */
export async function analyzeWithRetry(
  fileBuffer: Buffer,
  mimeType: string,
  documentTypeHint?: string,
  maxRetries: number = 3
): Promise<OpenAIAnalysisResponse> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await analyzeWithVision(fileBuffer, mimeType, documentTypeHint);
    } catch (error) {
      if (attempt === maxRetries - 1) {
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`Retrying in ${delay}ms... (attempt ${attempt + 1})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error('Max retries exceeded');
}
