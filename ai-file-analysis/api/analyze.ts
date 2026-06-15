import type { NextApiRequest, NextApiResponse } from 'next';
import { analyzeWithRetry } from '../lib/openai-vision';
import {
  uploadFile,
  storeAnalysisResult,
} from '../lib/supabase-client';
import { getUserRole, logAnalysisAction } from '../lib/permissions';
import { AnalysisResult, ApiError } from '../types/analysis';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AnalysisResult | ApiError>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Missing user ID', code: 'MISSING_USER_ID' });
  }

  try {
    const files = req.files as any;
    if (!files || !files.file) {
      return res.status(400).json({ error: 'No file provided', code: 'NO_FILE' });
    }

    const file = files.file as any;
    const userRole = await getUserRole(userId);

    if (file.size > MAX_FILE_SIZE) {
      return res.status(400).json({
        error: `File too large. Max size: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        code: 'FILE_TOO_LARGE',
      });
    }

    const uploadStart = Date.now();
    const { path: filePath, url: fileUrl } = await uploadFile(file, userId);
    console.log(`File uploaded in ${Date.now() - uploadStart}ms`);

    const analysisStart = Date.now();
    let analysisResult;

    if (file.mimetype.startsWith('image/')) {
      analysisResult = await analyzeWithRetry(
        file.data,
        file.mimetype,
        'finance document'
      );
    } else {
      return res.status(400).json({
        error: 'Unsupported file type',
        code: 'UNSUPPORTED_FILE_TYPE',
      });
    }

    const analysisTime = (Date.now() - analysisStart) / 1000;
    console.log(`Analysis completed in ${analysisTime}s`);

    const { id: analysisId } = await storeAnalysisResult({
      userId,
      detectedType: analysisResult.type,
      confidence: analysisResult.confidence,
      extractedData: analysisResult.data,
      suggestedAction: analysisResult.action,
      fileUrl,
      fileStoragePath: filePath,
      aiProvider: 'openai_vision',
    });

    await logAnalysisAction(userId, 'analysis_created', analysisId, {
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
        analysisTime,
        aiProvider: 'openai_vision',
        fileSize: file.size,
        fileMimeType: file.mimetype,
      },
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Analysis error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const userId = req.headers['x-user-id'] as string;

    if (userId) {
      await logAnalysisAction(userId, 'analysis_failed', 'unknown', {
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
