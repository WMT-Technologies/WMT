# AI File & Image Analysis - Setup Guide

## Prerequisites

- Node.js 18+
- npm or yarn
- Supabase account
- OpenAI API key

## Step 1: Install Dependencies

```bash
npm install @supabase/supabase-js @supabase/ssr openai
```

## Step 2: Set Up Supabase

### Create Storage Bucket

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Go to **Storage** → **New Bucket**
4. Name it: `ai-analysis-uploads`
5. Make it **private**

### Create Database Table

Go to **SQL Editor** and run:

```sql
CREATE TABLE ai_analysis_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  detected_type TEXT NOT NULL,
  confidence NUMERIC NOT NULL,
  extracted_data JSONB NOT NULL,
  suggested_action TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_storage_path TEXT NOT NULL,
  ai_provider TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  wmt_record_id TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_id ON ai_analysis_results(user_id);
CREATE INDEX idx_status ON ai_analysis_results(status);
CREATE INDEX idx_created_at ON ai_analysis_results(created_at);
```

## Step 3: Get API Keys

### OpenAI

1. Go to [OpenAI API Keys](https://platform.openai.com/api-keys)
2. Create a new secret key
3. Copy and save it

### Supabase

1. Go to **Settings** → **API**
2. Copy `Project URL` and `Publishable Key`
3. Go to **Settings** → **Service Role Secret**

## Step 4: Configure Environment Variables

Create `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENAI_API_KEY=sk_test_your_key_here
NEXT_PUBLIC_WMT_API_URL=https://api.wmt-example.com
WMT_API_KEY=your-wmt-api-key
```

## Step 5: Start Development

```bash
npm run dev
```

Visit `http://localhost:3000/analysis` to test.

## Troubleshooting

- **OpenAI Error**: Verify API key in `.env.local`
- **Supabase Error**: Check project URL and credentials
- **File Upload Error**: Verify bucket exists and RLS is configured
- **Permission Denied**: Check user role in database
