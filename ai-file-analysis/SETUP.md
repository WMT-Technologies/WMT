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

Apply `database/schema.sql` as a trusted database owner. It is the single source
for fresh installations and existing-table upgrades, including private storage,
server-only access, and workspace isolation. Do not use a table-only setup.

Before enabling the module, complete [AUTH_INTEGRATION.md](AUTH_INTEGRATION.md).
There is no default company, automatic approval, or default role.

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
