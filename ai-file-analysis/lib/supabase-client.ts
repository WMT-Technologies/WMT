import { randomUUID } from 'node:crypto';
import { assertOwnedPath, type AuthContext } from './auth';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (typeof window !== 'undefined') throw new Error('Server-only storage module');
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

export async function uploadFile(
  fileBuffer: Buffer,
  context: AuthContext,
  contentType: string = 'application/octet-stream',
  bucket: string = 'ai-analysis-uploads'
): Promise<{ path: string }> {
  try {
    const filename = `${context.workspaceId}/${context.userId}/${randomUUID()}`;

    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .upload(filename, fileBuffer, {
        cacheControl: '3600',
        contentType,
        upsert: false,
      });

    if (error) throw new Error(`Upload failed: ${error.message}`);
    return { path: data.path };
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}

export async function getFilePreviewUrl(filePath: string, context: AuthContext): Promise<string> {
  assertOwnedPath(context, filePath);
  const { data, error } = await supabaseAdmin.storage
    .from('ai-analysis-uploads')
    .createSignedUrl(filePath, 60);
  if (error) throw new Error('Unable to create private file preview');
  return data.signedUrl;
}

export async function deleteFile(
  filePath: string,
  context: AuthContext,
  bucket: string = 'ai-analysis-uploads'
): Promise<void> {
  try {
    assertOwnedPath(context, filePath);
    const { error } = await supabaseAdmin.storage
      .from(bucket)
      .remove([filePath]);

    if (error) throw new Error(`Delete failed: ${error.message}`);
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
}

export async function storeAnalysisResult(
  context: AuthContext,
  analysisData: {
    detectedType: string;
    confidence: number;
    extractedData: Record<string, any>;
    suggestedAction: string;
    fileStoragePath: string;
    aiProvider: string;
  }
): Promise<{ id: string }> {
  try {
    assertOwnedPath(context, analysisData.fileStoragePath);
    const { data, error } = await supabaseAdmin
      .from('ai_analysis_results')
      .insert([
        {
          user_id: context.userId,
          workspace_id: context.workspaceId,
          detected_type: analysisData.detectedType,
          confidence: analysisData.confidence,
          extracted_data: analysisData.extractedData,
          suggested_action: analysisData.suggestedAction,
          file_url: '',
          file_storage_path: analysisData.fileStoragePath,
          ai_provider: analysisData.aiProvider,
          status: 'pending',
          created_at: new Date().toISOString(),
        },
      ])
      .select('id')
      .single();

    if (error) throw new Error(`Database insert failed: ${error.message}`);
    return { id: data.id };
  } catch (error) {
    console.error('Error storing analysis result:', error);
    throw error;
  }
}

export async function getAnalysisResult(analysisId: string, context: AuthContext) {
  try {
    const { data, error } = await supabaseAdmin
      .from('ai_analysis_results')
      .select('*')
      .eq('id', analysisId)
      .eq('workspace_id', context.workspaceId)
      .eq('user_id', context.userId)
      .maybeSingle();

    if (error) throw new Error(`Database query failed: ${error.message}`);
    return data;
  } catch (error) {
    console.error('Error getting analysis result:', error);
    throw error;
  }
}

export async function updateAnalysisStatus(
  analysisId: string,
  status: 'pending' | 'approved' | 'rejected' | 'saved',
  context: AuthContext
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('ai_analysis_results')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', analysisId)
      .eq('workspace_id', context.workspaceId)
      .eq('user_id', context.userId);

    if (error) throw new Error(`Status update failed: ${error.message}`);
  } catch (error) {
    console.error('Error updating analysis status:', error);
    throw error;
  }
}

export async function saveAnalysisToWMT(
  analysisId: string,
  context: AuthContext,
  suggestedAction: string,
  approvedData: Record<string, any>
): Promise<{ recordId: string }> {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_WMT_API_URL;
    const apiKey = process.env.WMT_API_KEY;
    if (!apiUrl || !apiKey) throw new Error('WMT API is not configured');

    const response = await fetch(
      `${apiUrl.replace(/\/$/, '')}/ai-analysis/save`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          analysisId,
          userId: context.userId,
          workspaceId: context.workspaceId,
          action: suggestedAction,
          data: approvedData,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`WMT API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    if (!result?.id) throw new Error('WMT API did not return a record id');
    return { recordId: result.id };
  } catch (error) {
    console.error('Error saving to WMT:', error);
    throw error;
  }
}
