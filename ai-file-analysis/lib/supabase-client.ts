import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables not configured');
}

// Client for browser/public operations
export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

// Server-side client with service role (use only on backend)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Upload file to Supabase Storage
 */
export async function uploadFile(
  file: File,
  userId: string,
  bucket: string = 'ai-analysis-uploads'
): Promise<{ path: string; url: string }> {
  try {
    const timestamp = Date.now();
    const filename = `${userId}/${timestamp}-${file.name}`;

    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .upload(filename, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      throw new Error(`Upload failed: ${error.message}`);
    }

    const { data: publicData } = supabaseAdmin.storage
      .from(bucket)
      .getPublicUrl(filename);

    return {
      path: data.path,
      url: publicData.publicUrl,
    };
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}

/**
 * Delete file from Supabase Storage
 */
export async function deleteFile(
  filePath: string,
  bucket: string = 'ai-analysis-uploads'
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.storage
      .from(bucket)
      .remove([filePath]);

    if (error) {
      throw new Error(`Delete failed: ${error.message}`);
    }
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
}

/**
 * Store analysis result in database
 */
export async function storeAnalysisResult(
  analysisData: {
    userId: string;
    detectedType: string;
    confidence: number;
    extractedData: Record<string, any>;
    suggestedAction: string;
    fileUrl: string;
    fileStoragePath: string;
    aiProvider: string;
  }
): Promise<{ id: string }> {
  try {
    const { data, error } = await supabaseAdmin
      .from('ai_analysis_results')
      .insert([
        {
          user_id: analysisData.userId,
          detected_type: analysisData.detectedType,
          confidence: analysisData.confidence,
          extracted_data: analysisData.extractedData,
          suggested_action: analysisData.suggestedAction,
          file_url: analysisData.fileUrl,
          file_storage_path: analysisData.fileStoragePath,
          ai_provider: analysisData.aiProvider,
          status: 'pending',
          created_at: new Date().toISOString(),
        },
      ])
      .select('id')
      .single();

    if (error) {
      throw new Error(`Database insert failed: ${error.message}`);
    }

    return { id: data.id };
  } catch (error) {
    console.error('Error storing analysis result:', error);
    throw error;
  }
}

/**
 * Get analysis result from database
 */
export async function getAnalysisResult(analysisId: string) {
  try {
    const { data, error } = await supabaseAdmin
      .from('ai_analysis_results')
      .select('*')
      .eq('id', analysisId)
      .single();

    if (error) {
      throw new Error(`Database query failed: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error('Error getting analysis result:', error);
    throw error;
  }
}

/**
 * Update analysis status
 */
export async function updateAnalysisStatus(
  analysisId: string,
  status: 'pending' | 'approved' | 'rejected' | 'saved'
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('ai_analysis_results')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', analysisId);

    if (error) {
      throw new Error(`Status update failed: ${error.message}`);
    }
  } catch (error) {
    console.error('Error updating analysis status:', error);
    throw error;
  }
}

/**
 * Save approved analysis to WMT database
 */
export async function saveAnalysisToWMT(
  analysisId: string,
  userId: string,
  suggestedAction: string,
  approvedData: Record<string, any>
): Promise<{ recordId: string }> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_WMT_API_URL}/ai-analysis/save`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.WMT_API_KEY}`,
        },
        body: JSON.stringify({
          analysisId,
          userId,
          action: suggestedAction,
          data: approvedData,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`WMT API error: ${response.statusText}`);
    }

    const result = await response.json();
    return { recordId: result.id };
  } catch (error) {
    console.error('Error saving to WMT:', error);
    throw error;
  }
}
