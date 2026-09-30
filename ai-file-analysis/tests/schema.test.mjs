import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.WMT_TEST_PGLITE_MODULE || '@electric-sql/pglite');
const schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');

test('schema upgrade closes direct access, preserves unrelated buckets and quarantines legacy records', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA storage;
      GRANT USAGE ON SCHEMA public, storage TO anon, authenticated, service_role;
      CREATE TABLE storage.buckets (id text primary key, name text, public boolean);
      CREATE TABLE storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
      CREATE POLICY existing_broad_policy ON storage.objects FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
      CREATE TABLE public.ai_analysis_results (
        id uuid default gen_random_uuid() primary key, user_id text not null,
        detected_type text not null, confidence numeric not null, extracted_data jsonb not null,
        suggested_action text not null, file_url text not null, file_storage_path text not null,
        ai_provider text not null, status text default 'pending', wmt_record_id text,
        created_at timestamp default now(), updated_at timestamp default now()
      );
      GRANT ALL ON public.ai_analysis_results TO anon, authenticated;
      INSERT INTO public.ai_analysis_results(user_id, detected_type, confidence, extracted_data, suggested_action, file_url, file_storage_path, ai_provider)
        VALUES ('legacy-user','invoice',1,'{}','create_invoice','old-url','old-path','test');
      INSERT INTO storage.buckets VALUES ('ai-analysis-uploads','ai-analysis-uploads',true);
      INSERT INTO storage.objects(bucket_id,name) VALUES ('ai-analysis-uploads','private'),('unrelated-bucket','public');
    `);
    await db.exec(schema);
    await db.exec(schema); // The upgrade must be repeatable.
    assert.equal((await db.query("SELECT public FROM storage.buckets WHERE id = 'ai-analysis-uploads'")).rows[0].public, false);
    assert.equal((await db.query('SELECT workspace_id FROM public.ai_analysis_results')).rows[0].workspace_id, null);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query('SELECT * FROM public.ai_analysis_results'), /permission denied/);
      await assert.rejects(db.query('SELECT * FROM public.ai_analysis_audit'), /permission denied/);
      assert.deepEqual((await db.query('SELECT name FROM storage.objects')).rows.map(x => x.name), ['public']);
      await assert.rejects(db.exec("INSERT INTO storage.objects(bucket_id,name) VALUES ('ai-analysis-uploads','forged')"), /row-level security/);
      await db.exec('RESET ROLE');
    }
    // Even accidental re-granting does not restore user-only access.
    await db.exec('GRANT SELECT ON public.ai_analysis_results TO authenticated; SET ROLE authenticated');
    assert.equal((await db.query('SELECT * FROM public.ai_analysis_results')).rows.length, 0);
    await db.exec('RESET ROLE; SET ROLE service_role');
    await assert.rejects(db.exec(`INSERT INTO public.ai_analysis_results(user_id, detected_type, confidence, extracted_data, suggested_action, file_url, file_storage_path, ai_provider)
      VALUES ('u','invoice',1,'{}','create_invoice','','path','test')`), /ai_analysis_workspace_required/);
    await db.exec(`INSERT INTO public.ai_analysis_results(user_id, workspace_id, detected_type, confidence, extracted_data, suggested_action, file_url, file_storage_path, ai_provider)
      VALUES ('u','company-a','invoice',1,'{}','create_invoice','','company-a/u/file','test')`);
    assert.equal((await db.query("SELECT * FROM public.ai_analysis_results WHERE workspace_id='company-a' AND user_id='u'")).rows.length, 1);
  } finally { await db.close(); }
});
