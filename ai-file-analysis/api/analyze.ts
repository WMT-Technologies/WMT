import type { NextApiRequest, NextApiResponse } from 'next';
import { readFile } from 'node:fs/promises';
import formidable from 'formidable';
import { analyzeWithRetry, isSupportedAnalysisMimeType } from '../lib/openai-vision';
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

class FileInputError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

function normalizeMimeType(file: any): string {
  const supplied = String(file?.mimetype || file?.type || '')
    .toLowerCase()
    .split(';', 1)[0]
    .trim();
  if (supplied && supplied !== 'application/octet-stream') return supplied;

  const name = String(file?.name || file?.originalFilename || '');
  const extension = name.toLowerCase().split('.').pop() || '';
  return MIME_BY_EXTENSION[extension] || supplied;
}

function normalizeFile(file: any): {
  data: Buffer;
  size: number;
  mimetype: string;
  name: string;
} {
  const data = Buffer.isBuffer(file?.data)
    ? file.data
    : file?.data instanceof Uint8Array
      ? Buffer.from(file.data)
      : Buffer.alloc(0);

  return {
    data,
    size: Number(file?.size ?? data.length ?? 0),
    mimetype: normalizeMimeType(file),
    name: String(file?.name || file?.originalFilename || 'document'),
  };
}

async function readIncomingFile(req: NextApiRequest): Promise<{
  data: Buffer;
  size: number;
  mimetype: string;
  name: string;
}> {
  // Preserve compatibility with a host that already parsed multipart.
  const preParsedFiles = (req as any).files;
  const preParsed = Array.isArray(preParsedFiles?.file)
    ? preParsedFiles.file[0]
    : preParsedFiles?.file;
  if (preParsed) return normalizeFile(preParsed);

  if (!String(req.headers['content-type'] || '').toLowerCase().includes('multipart/form-data')) {
    throw new FileInputError(400, 'INVALID_UPLOAD', 'Expected multipart/form-data upload');
  }

  const form = formidable({
    multiples: false,
    maxFiles: 1,
    maxFileSize: MAX_FILE_SIZE,
    maxFields: 5,
    maxFieldsSize: 16 * 1024,
    allowEmptyFiles: false,
    minFileSize: 1,
  });

  const parsedFiles: any = await new Promise((resolve, reject) => {
    form.parse(req, (error, _fields, files) => {
      if (error) return reject(error);
      resolve(files);
    });
  }).catch((error: any) => {
    const message = error instanceof Error ? error.message : 'Invalid multipart upload';
    const tooLarge = /maxFileSize|maxTotalFileSize|too large/i.test(message);
    throw new FileInputError(
      400,
      tooLarge ? 'FILE_TOO_LARGE' : 'INVALID_UPLOAD',
      tooLarge ? `File too large. Max size: ${MAX_FILE_SIZE / 1024 / 1024}MB` : 'Invalid file upload'
    );
  });

  const uploaded = Array.isArray(parsedFiles?.file)
    ? parsedFiles.file[0]
    : parsedFiles?.file;
  if (!uploaded?.filepath) {
    throw new FileInputError(400, 'NO_FILE', 'No file provided');
  }

  const data = await readFile(uploaded.filepath);
  return normalizeFile({
    name: uploaded.originalFilename,
    size: uploaded.size,
    mimetype: uploaded.mimetype,
    data,
  });
}

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
    const file = await readIncomingFile(req);

    if (!file.data.length) {
      return res.status(400).json({ error: 'File is empty or unreadable', code: 'EMPTY_FILE' });
    }

    if (file.size > MAX_FILE_SIZE || file.data.length > MAX_FILE_SIZE) {
      return res.status(400).json({
        error: `File too large. Max size: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        code: 'FILE_TOO_LARGE',
      });
    }

    if (!isSupportedAnalysisMimeType(file.mimetype)) {
      return res.status(400).json({
        error: 'Unsupported file type. Use PDF, Excel, CSV, Word, JPG, PNG, GIF, or WEBP.',
        code: 'UNSUPPORTED_FILE_TYPE',
      });
    }

    const uploadStart = Date.now();
    const { path: filePath } = await uploadFile(file.data, context, file.mimetype);
    uploadedPath = filePath;
    console.log(`File uploaded in ${Date.now() - uploadStart}ms`);

    const analysisStart = Date.now();
    const analysisResult = await analyzeWithRetry(
      file.data,
      file.mimetype,
      'business document',
      file.name
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
      aiProvider: 'openai_responses',
    });

    analysisStored = true;
    const fileUrl = await getFilePreviewUrl(filePath, context);

    await logAnalysisAction(userId, 'analysis_created', analysisId, {
      workspaceId,
      documentType: analysisResult.type,
      confidence: analysisResult.confidence,
      userRole,
      fileMimeType: file.mimetype,
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
        aiProvider: 'openai_responses',
        fileSize: file.size,
        fileMimeType: file.mimetype,
      },
    };

    res.status(200).json(response);
  } catch (error) {
    if (context && uploadedPath && !analysisStored) {
      await deleteFile(uploadedPath, context).catch(() => console.error('Failed to remove rejected upload'));
    }
    if (error instanceof AccessError || error instanceof FileInputError) {
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

    if (errorMessage.includes('OPENAI_API_KEY')) {
      return res.status(503).json({
        error: 'AI analysis is not configured',
        code: 'AI_NOT_CONFIGURED',
      });
    }

    res.status(502).json({
      error: 'Analysis failed',
      code: 'ANALYSIS_FAILED',
      details: errorMessage,
    });
  }
}

export const config = {
  api: {
    // Multipart must remain a raw stream for Formidable.
    bodyParser: false,
  },
};
