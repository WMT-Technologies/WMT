import type { NextApiRequest, NextApiResponse } from 'next';
import {
  updateAnalysisStatus,
  getAnalysisResult,
  saveAnalysisToWMT,
} from '../lib/supabase-client';
import {
  validateUserPermission,
  logAnalysisAction,
  getUserRole,
  canHandleDocumentType,
} from '../lib/permissions';
import { SaveAnalysisResponse, ApiError } from '../types/analysis';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SaveAnalysisResponse | ApiError>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Missing user ID', code: 'MISSING_USER_ID' });
  }

  try {
    const { analysisId, approvedData, notes } = req.body;

    if (!analysisId || !approvedData) {
      return res.status(400).json({
        error: 'Missing required fields: analysisId, approvedData',
        code: 'MISSING_FIELDS',
      });
    }

    const analysis = await getAnalysisResult(analysisId);
    if (!analysis) {
      return res.status(404).json({
        error: 'Analysis not found',
        code: 'NOT_FOUND',
      });
    }

    if (analysis.user_id !== userId) {
      return res.status(403).json({
        error: 'Not authorized to save this analysis',
        code: 'NOT_AUTHORIZED',
      });
    }

    const userRole = await getUserRole(userId);

    if (!canHandleDocumentType(userRole, analysis.detected_type)) {
      return res.status(403).json({
        error: `User role '${userRole}' cannot handle '${analysis.detected_type}' documents`,
        code: 'CANNOT_HANDLE_DOCUMENT_TYPE',
      });
    }

    const permissionCheck = await validateUserPermission(userId, analysis.suggested_action);
    if (!permissionCheck.allowed) {
      return res.status(403).json({
        error: permissionCheck.reason || 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }

    let recordId: string | undefined;
    try {
      const result = await saveAnalysisToWMT(
        analysisId,
        userId,
        analysis.suggested_action,
        approvedData
      );
      recordId = result.recordId;
    } catch (wmtError) {
      console.error('Error saving to WMT:', wmtError);
    }

    await updateAnalysisStatus(analysisId, 'saved');

    await logAnalysisAction(userId, 'analysis_saved', analysisId, {
      documentType: analysis.detected_type,
      suggestedAction: analysis.suggested_action,
      userRole,
      wmtRecordId: recordId,
      notes,
    });

    const response: SaveAnalysisResponse = {
      success: true,
      recordId,
      message: `Analysis saved successfully${recordId ? ' to WMT' : ''}`,
      savedAt: new Date().toISOString(),
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Save analysis error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await logAnalysisAction(userId, 'analysis_save_failed', req.body.analysisId, {
      error: errorMessage,
    }).catch(err => console.error('Failed to log error:', err));

    res.status(500).json({
      error: 'Failed to save analysis',
      code: 'SAVE_FAILED',
      details: errorMessage,
    });
  }
}
