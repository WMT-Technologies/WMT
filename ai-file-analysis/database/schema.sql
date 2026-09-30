-- Module schema and upgrade script. Apply with a trusted database owner.
-- This module intentionally exposes data ONLY through its authenticated server APIs.
BEGIN;
CREATE TABLE IF NOT EXISTS public.ai_analysis_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  detected_type TEXT NOT NULL,
  confidence NUMERIC NOT NULL,
  extracted_data JSONB NOT NULL,
  suggested_action TEXT NOT NULL,
  file_url TEXT NOT NULL DEFAULT '',
  file_storage_path TEXT NOT NULL,
  ai_provider TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'saved')),
  wmt_record_id TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
-- Existing rows remain NULL and inaccessible until ownership is independently verified.
-- Never guess a default workspace or backfill all rows into one company.
ALTER TABLE public.ai_analysis_results ADD COLUMN IF NOT EXISTS workspace_id TEXT;
ALTER TABLE public.ai_analysis_results ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.ai_analysis_results DROP CONSTRAINT IF EXISTS ai_analysis_workspace_required;
ALTER TABLE public.ai_analysis_results ADD CONSTRAINT ai_analysis_workspace_required
  CHECK (workspace_id IS NOT NULL AND workspace_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$') NOT VALID;
CREATE INDEX IF NOT EXISTS idx_analysis_workspace_user
  ON public.ai_analysis_results(workspace_id, user_id, id);
ALTER TABLE public.ai_analysis_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_analysis_results FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_analysis_results TO service_role;
-- Remove the old user-only policies (no company isolation and stale JWT approval).
DROP POLICY IF EXISTS "Users can view their own analyses" ON public.ai_analysis_results;
DROP POLICY IF EXISTS "Users can insert their own analyses" ON public.ai_analysis_results;
DROP POLICY IF EXISTS "Users can update their own pending analyses" ON public.ai_analysis_results;
-- Defense in depth even if table privileges are granted again later.
DROP POLICY IF EXISTS "Analysis server access only" ON public.ai_analysis_results;
CREATE POLICY "Analysis server access only" ON public.ai_analysis_results
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

INSERT INTO storage.buckets (id, name, public)
VALUES ('ai-analysis-uploads', 'ai-analysis-uploads', false)
ON CONFLICT (id) DO UPDATE SET public = false;
DROP POLICY IF EXISTS "Users can upload files" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own files" ON storage.objects;
DROP POLICY IF EXISTS "Service role has full storage access" ON storage.objects;
-- Block direct Storage calls for THIS bucket, including via stale access tokens.
-- Other buckets retain their existing access policies.
DROP POLICY IF EXISTS "AI analysis storage server access only" ON storage.objects;
CREATE POLICY "AI analysis storage server access only" ON storage.objects
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (bucket_id <> 'ai-analysis-uploads')
  WITH CHECK (bucket_id <> 'ai-analysis-uploads');

CREATE TABLE IF NOT EXISTS public.ai_analysis_audit (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  action TEXT NOT NULL,
  analysis_id UUID,
  document_type TEXT,
  status TEXT,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE public.ai_analysis_audit ADD COLUMN IF NOT EXISTS workspace_id TEXT;
ALTER TABLE public.ai_analysis_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_analysis_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.ai_analysis_audit TO service_role;
COMMIT;
