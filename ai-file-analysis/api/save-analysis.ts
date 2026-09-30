import type { NextApiRequest, NextApiResponse } from 'next';
import {
  updateAnalysisStatus,
  getAnalysisResult,
  saveAnalysisToWMT,
} from '../lib/supabase-client';
import {
  hasPermission,
  logAnalysisAction,
  canHandleDocumentType,
} from '../lib/permissions';
import { requireAuth, AccessError, type AuthContext } from '../lib/auth';
import type { SaveAnalysisResponse, ApiError } from '../types/analysis';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SaveAnalysisResponse | ApiError>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  let context: AuthContext | undefined;

  try {
    context = await requireAuth(req);
    const { userId, workspaceId, role: userRole } = context;
    const { analysisId, approvedData, notes } = req.body;

    if (!analysisId || !approvedData) {
      return res.status(400).json({
        error: 'Missing required fields: analysisId, approvedData',
        code: 'MISSING_FIELDS',
      });
    }

    const analysis = await getAnalysisResult(analysisId, context);
    if (!analysis) {
      return res.status(404).json({
        error: 'Analysis not found',
        code: 'NOT_FOUND',
      });
    }

    if (analysis.user_id !== userId || analysis.workspace_id !== workspaceId) {
      return res.status(403).json({
        error: 'Not authorized to save this analysis',
        code: 'NOT_AUTHORIZED',
      });
    }

    if (!canHandleDocumentType(userRole, analysis.detected_type)) {
      return res.status(403).json({
        error: `User role '${userRole}' cannot handle '${analysis.detected_type}' documents`,
        code: 'CANNOT_HANDLE_DOCUMENT_TYPE',
      });
    }

    if (!hasPermission(userRole, analysis.suggested_action)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }

    const result = await saveAnalysisToWMT(
      analysisId,
      context,
      analysis.suggested_action,
      approvedData
    );
    const recordId = result.recordId;

    await updateAnalysisStatus(analysisId, 'saved', context);

    await logAnalysisAction(userId, 'analysis_saved', analysisId, {
      workspaceId,
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
    if (error instanceof AccessError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    console.error('Save analysis error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (context) {
      await logAnalysisAction(context.userId, 'analysis_save_failed', req.body?.analysisId, {
        workspaceId: context.workspaceId,
        error: errorMessage,
      }).catch(err => console.error('Failed to log error:', err));
    }

    res.status(500).json({
      error: 'Failed to save analysis',
      code: 'SAVE_FAILED',
      details: errorMessage,
    });
  }
}
