import { promises as fs } from 'node:fs';
import path from 'node:path';

import JSZip from 'jszip';
import { getSupabaseAdminClient } from '../server/supabaseAdmin.js';

type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  setHeader: (name: string, value: string) => void;
  end: (body?: unknown) => void;
  json: (body: unknown) => void;
};

type SourceTableResult = {
  table: string;
  status: 'included' | 'missing' | 'empty' | 'error';
  rows: unknown[];
  rowCount: number;
  error?: string;
};

type BackupManifest = {
  generatedAt: string;
  requestedBy: 'admin';
  includeDatabase: boolean;
  projectRoot: string;
  supabase: {
    configured: boolean;
    message: string;
  };
  includedFiles: {
    totalFiles: number;
    skippedFiles: number;
    totalBytes: number;
    skippedReasons: string[];
  };
  database: {
    tables: SourceTableResult[];
  };
};

type CollectTarget = {
  path: string;
};

const DEFAULT_TABLES = [
  'pricing_config',
  'training_data',
  'agent_model_settings',
  'estimate_sessions',
  'estimate_records',
] as const;

const SOURCE_ROOT = process.cwd();
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const DATABASE_FOLDER = 'database';
const FILES_ROOTS: CollectTarget[] = [
  { path: 'api' },
  { path: 'src' },
  { path: 'server' },
  { path: 'public' },
  { path: 'docs' },
  { path: 'dist' },
  { path: 'GHL/steamzone.ca/data/training' },
];

const ROOT_FILES: string[] = [
  '.env.example',
  'AGENTS.md',
  'index.html',
  'eslint.config.js',
  'postcss.config.js',
  'package.json',
  'package-lock.json',
  'tailwind.config.js',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'tsconfig.json',
  'vite.config.ts',
];

const SKIP_DIRECTORIES = new Set(['.git', '.github', 'node_modules', '.vercel', '.bolt']);
const SKIP_ROOT_FILES = new Set(['steamzone-project.zip']);

function normalizeDbMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown database error.';
}

function isMissingTableError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('does not exist') ||
    lower.includes('relation') ||
    lower.includes('schema cache') ||
    lower.includes('could not find')
  );
}

async function exportDbTable(supabase: Awaited<ReturnType<typeof getSupabaseAdminClient>>, table: string): Promise<SourceTableResult> {
  if (!supabase) {
    return {
      table,
      status: 'error',
      rows: [],
      rowCount: 0,
      error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.',
    };
  }

  try {
    const result = await supabase
      .from(table)
      .select('*', { count: 'exact' });
    const error = result.error;

    if (error) {
      const message = error.message ?? 'Unknown error reading table.';
      if (isMissingTableError(message)) {
        return { table, status: 'missing', rows: [], rowCount: 0, error: message };
      }

      return { table, status: 'error', rows: [], rowCount: 0, error: message };
    }

    const rows = Array.isArray(result.data) ? result.data : [];
    const count = typeof result.count === 'number' ? result.count : rows.length;
    return {
      table,
      status: rows.length > 0 || count > 0 ? 'included' : 'empty',
      rows,
      rowCount: count,
    };
  } catch (error) {
    return {
      table,
      status: 'error',
      rows: [],
      rowCount: 0,
      error: normalizeDbMessage(error),
    };
  }
}

function shouldSkipName(name: string): boolean {
  if (name === '.' || name === '..') {
    return true;
  }

  if (SKIP_DIRECTORIES.has(name)) {
    return true;
  }

  return SKIP_ROOT_FILES.has(name);
}

function normalizeZipPath(raw: string): string {
  return raw.replace(/\\/g, '/');
}

async function addDirectoryToZip(
  zip: JSZip,
  absRoot: string,
  relRoot: string,
  manifest: BackupManifest['includedFiles'],
  fileCount: { total: number; skipped: number; bytes: number }
): Promise<void> {
  try {
    const entries = await fs.readdir(absRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldSkipName(entry.name)) {
        continue;
      }

      const absPath = path.join(absRoot, entry.name);
      const relPath = normalizeZipPath(path.join(relRoot, entry.name));

      if (entry.isDirectory()) {
        if (shouldSkipName(entry.name)) {
          continue;
        }
        await addDirectoryToZip(zip, absPath, relPath, manifest, fileCount);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (SKIP_ROOT_FILES.has(entry.name)) {
        manifest.skippedReasons.push(`Skipped archive marker by name: ${relPath}`);
        fileCount.skipped += 1;
        continue;
      }

      try {
        const stats = await fs.stat(absPath);
        if (stats.size > MAX_FILE_BYTES) {
          fileCount.skipped += 1;
          manifest.skippedReasons.push(`Skipped large file (${stats.size} bytes): ${relPath}`);
          continue;
        }

        const data = await fs.readFile(absPath);
        zip.file(`site/${relPath}`, data);
        fileCount.total += 1;
        fileCount.bytes += data.byteLength;
      } catch (error) {
        fileCount.skipped += 1;
        manifest.skippedReasons.push(`Unable to read ${relPath}: ${normalizeDbMessage(error)}`);
      }
    }
  } catch (error) {
    manifest.skippedReasons.push(`Unable to read directory ${relRoot}: ${normalizeDbMessage(error)}`);
  }
}

function parseBackupBody(body: unknown): { includeDatabase: boolean } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { includeDatabase: true };
  }

  const requested = body as { includeDatabase?: unknown };
  if (requested.includeDatabase === false) {
    return { includeDatabase: false };
  }

  return { includeDatabase: true };
}

function isTextMethod(req: ApiRequest): boolean {
  return req.method === 'POST';
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!isTextMethod(req)) {
    res.status(405).json({ message: 'Method not allowed.' });
    return;
  }

  const { includeDatabase } = parseBackupBody(
    typeof req.body === 'string' ? (() => {
      try {
        return JSON.parse(req.body);
      } catch {
        return null;
      }
    })() : req.body
  );

  const manifest: BackupManifest = {
    generatedAt: new Date().toISOString(),
    requestedBy: 'admin',
    includeDatabase,
    projectRoot: SOURCE_ROOT,
    supabase: {
      configured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      message: '',
    },
    includedFiles: {
      totalFiles: 0,
      skippedFiles: 0,
      totalBytes: 0,
      skippedReasons: [],
    },
    database: {
      tables: [],
    },
  };

  const fileCount = { total: 0, skipped: 0, bytes: 0 };
  const zip = new JSZip();

  for (const entry of ROOT_FILES) {
    const abs = path.join(SOURCE_ROOT, entry);
    try {
      const stats = await fs.stat(abs);
      if (!stats.isFile()) {
        manifest.includedFiles.skippedReasons.push(`Skipped missing file: ${entry}`);
        fileCount.skipped += 1;
        continue;
      }

      if (stats.size > MAX_FILE_BYTES) {
        manifest.includedFiles.skippedReasons.push(`Skipped large root file (${stats.size} bytes): ${entry}`);
        fileCount.skipped += 1;
        continue;
      }

      const data = await fs.readFile(abs);
      zip.file(`site/${entry}`, data);
      fileCount.total += 1;
      fileCount.bytes += data.byteLength;
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        manifest.includedFiles.skippedReasons.push(`Root file read error ${entry}: ${normalizeDbMessage(error)}`);
      }
      fileCount.skipped += 1;
    }
  }

  for (const target of FILES_ROOTS) {
    const absRoot = path.join(SOURCE_ROOT, target.path);
    const initialReasonCount = manifest.includedFiles.skippedReasons.length;
    await addDirectoryToZip(zip, absRoot, target.path, manifest.includedFiles, fileCount);
    if (manifest.includedFiles.skippedReasons.length === initialReasonCount) {
      // If directory doesn't exist, avoid failing backup by adding a message.
      try {
        await fs.access(absRoot);
      } catch {
        manifest.includedFiles.skippedReasons.push(`Directory not found: ${target.path}`);
        fileCount.skipped += 1;
      }
    }
  }

  if (includeDatabase) {
    const supabase = await getSupabaseAdminClient();
    manifest.supabase.message = supabase ? 'Configured and available.' : 'Not configured or unavailable.';
    manifest.database.tables = await Promise.all(DEFAULT_TABLES.map((table) => exportDbTable(supabase, table)));
    const dbPayload = JSON.stringify(
      {
        generatedAt: manifest.generatedAt,
        tables: manifest.database.tables,
      },
      null,
      2
    );
    zip.file(`${DATABASE_FOLDER}/database-export.json`, dbPayload);
    fileCount.total += 1;
    fileCount.bytes += Buffer.byteLength(dbPayload, 'utf8');
  } else {
    manifest.supabase.message = manifest.supabase.configured ? 'Configured, but not requested.' : 'Not configured or unavailable.';
    manifest.database.tables = [];
    zip.file(`${DATABASE_FOLDER}/database-export.json`, JSON.stringify({ generatedAt: manifest.generatedAt, message: 'Database export skipped by request.' }, null, 2));
    fileCount.total += 1;
    fileCount.bytes += 64;
  }

  manifest.includedFiles.totalFiles = fileCount.total;
  manifest.includedFiles.skippedFiles = fileCount.skipped;
  manifest.includedFiles.totalBytes = fileCount.bytes;

  zip.file('backup-manifest.json', JSON.stringify(manifest, null, 2));
  fileCount.total += 1;
  fileCount.bytes += Buffer.byteLength(JSON.stringify(manifest), 'utf8');

  try {
    const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const safeTimestamp = new Date(manifest.generatedAt).toISOString().replace(/[:.]/g, '-');
    const filename = `steamzone-site-backup-${safeTimestamp}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(archive.byteLength));
    res.status(200);
    res.end(archive);
  } catch {
    res.status(500).json({ message: 'Unable to generate site backup zip.' });
  }
}
