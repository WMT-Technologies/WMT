# AI File & Image Analysis Integration

Simple implementation for file/image analysis using OpenAI Vision API and Supabase without building OCR/recognition from scratch.

## Features

- **Multi-format Support**: Photos, PDFs, Excel, Word, receipts, invoices, employee documents, transaction screenshots
- **AI-Powered Extraction**: OpenAI Vision API
- **Permission-Based Access**: Role-based control (Sales, HR, Finance, Project)
- **Approval Workflow**: User review before data persistence
- **Structured Output**: JSON extraction with confidence scores
- **Supabase Integration**: Secure file storage

## Document Types & Permissions

| Document Type | Roles with Access | Suggested Action |
|---|---|---|
| Employee Document | HR | create_employee_profile |
| Receipt/Invoice | Finance | create_expense_record |
| Customer Inquiry Photo | Sales | create_crm_inquiry |
| Site Photo/Drawing | Project | create_project_document |
| Transaction Screenshot | Finance | create_transaction |

## Quick Start

1. Install dependencies: `npm install @supabase/supabase-js @supabase/ssr openai`
2. Configure `.env.local`
3. Run Supabase SQL setup
4. Copy files to your project
5. Start dev server: `npm run dev`

## Setup Instructions

See SETUP.md for detailed setup guide.

## API Response Format

```json
{
  "id": "analysis_123",
  "detectedType": "employee_document",
  "confidence": 0.91,
  "extractedData": {
    "name": "John Doe",
    "idNumber": "1234567890",
    "expiryDate": "2025-12-31",
    "nationality": "USA"
  },
  "suggestedAction": "create_employee_profile",
  "requiresApproval": true,
  "fileUrl": "https://storage.supabase.co/..."
}
```

## Security

✅ Permission checks before saving
✅ File validation before processing
✅ Supabase RLS policies
✅ API key management in .env
✅ User audit trail
✅ Sensitive data not logged
✅ File size limits enforced
