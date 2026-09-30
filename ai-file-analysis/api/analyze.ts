import type { NextApiRequest, NextApiResponse } from 'next';
import { analyzeWithRetry } from '../lib/openai-vision';
import {
  uploadFile,
  deleteFile,
  getFilePreviewUrl,
  storeAnalysisResult,
} from '../lib/supabase-client';
import { canHandleDocumentType, hasPermission, logAnalysisAction } from '../lib/permissions';
import { requireAuth, AccessError, type AuthContext } from '../lib/auth';
import type { AnalysisResult, ApiError } from '../types/analysis';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AnalysisResult | ApiError>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  let context: AuthContext | undefined;
  let uploadedPath: string | undefined;
  let analysisStored = false;

  try {
    context = await requireAuth(req);
    const { userId, workspaceId, role: userRole } = context;
    const files = req.files as any;
    if (!files || !files.file) {
      return res.status(400).json({ error: 'No file provided', code: 'NO_FILE' });
    }

    const file = files.file as any;

    if (file.size > MAX_FILE_SIZE) {
      return res.status(400).json({
        error: `File too large. Max size: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        code: 'FILE_TOO_LARGE',
      });
    }

    if (!file.mimetype?.startsWith('image/')) {
      return res.status(400).json({ error: 'Unsupported file type', code: 'UNSUPPORTED_FILE_TYPE' });
    }

    const uploadStart = Date.now();
    const { path: filePath } = await uploadFile(file, context);
    uploadedPath = filePath;
    console.log(`File uploaded in ${Date.now() - uploadStart}ms`);

    const analysisStart = Date.now();
    const analysisResult = await analyzeWithRetry(
      file.data,
      file.mimetype,
      'finance document'
    );

    const analysisTime = (Date.now() - analysisStart) / 1000;
    console.log(`Analysis completed in ${analysisTime}s`);

    if (!canHandleDocumentType(userRole, analysisResult.type) || !hasPermission(userRole, analysisResult.action)) {
      throw new AccessError(403, 'DOCUMENT_ACCESS_DENIED', 'Insufficient permissions for this document');
    }

    const { id: analysisId } = await storeAnalysisResult(context, {
      detectedType: analysisResult.type,
      confidence: analysisResult.confidence,
      extractedData: analysisResult.data,
      suggestedAction: analysisResult.action,
      fileStoragePath: filePath,
      aiProvider: 'openai_vision',
    });

    analysisStored = true;
    const fileUrl = await getFilePreviewUrl(filePath, context);

    await logAnalysisAction(userId, 'analysis_created', analysisId, {
      workspaceId,
      documentType: analysisResult.type,
      confidence: analysisResult.confidence,
      userRole,
    });

    const response: AnalysisResult = {
      id: analysisId,
      detectedType: analysisResult.type,
      confidence: analysisResult.confidence,
      extractedData: analysisResult.data,
      suggestedAction: analysisResult.action,
      requiresApproval: true,
      fileUrl,
      fileStoragePath: filePath,
      analysisMetadata: {
        uploadedAt: new Date().toISOString(),
        userId,
        workspaceId,
        analysisTime,
        aiProvider: 'openai_vision',
        fileSize: file.size,
        fileMimeType: file.mimetype,
      },
    };

    res.status(200).json(response);
  } catch (error) {
    if (context && uploadedPath && !analysisStored) {
      await deleteFile(uploadedPath, context).catch(() => console.error('Failed to remove rejected upload'));
    }
    if (error instanceof AccessError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    console.error('Analysis error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (context) {
      await logAnalysisAction(context.userId, 'analysis_failed', 'unknown', {
        workspaceId: context.workspaceId,
        error: errorMessage,
      }).catch(err => console.error('Failed to log error:', err));
    }

    res.status(500).json({
      error: 'Analysis failed',
      code: 'ANALYSIS_FAILED',
      details: errorMessage,
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};
