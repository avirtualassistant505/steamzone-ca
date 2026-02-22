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
  candidateRoots: string[];
  resolvedRoot: string;
  projectRoot: string;
  sourceMode: 'local' | 'local-and-remote-fallback';
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

type DirectoryOptions = {
  includeNodeModules: boolean;
  includeOnly?: (relPath: string, absPath: string) => boolean;
};

type CollectTarget = {
  path: string;
  options?: DirectoryOptions;
};

type GitHubSnapshotConfig = {
  owner: string;
  repo: string;
  ref: string;
  token?: string;
  fallbackUrl: string;
};

const DEFAULT_TABLES = [
  'pricing_config',
  'training_data',
  'agent_model_settings',
  'estimate_sessions',
  'estimate_records',
] as const;

const PROJECT_MARKERS = ['package.json', 'api', 'src', 'server', 'public', 'index.html'];
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_PROJECT_SEARCH_DEPTH = 6;
const DATABASE_FOLDER = 'database';

const PROJECT_ROOT_HINTS = [
  process.env.SITE_BACKUP_SOURCE_ROOT,
  process.env.STEAMZONE_BACKUP_SOURCE_ROOT,
  process.env.REPOSITORY_ROOT,
  process.env.PROJECT_ROOT,
  process.env.VERCEL_PROJECT_PATH,
  process.env.VERCEL_PATH,
  process.env.VERCEL_PATH0,
  '/var/task',
  '/vercel/path0',
  '/workspace/default',
  '/workspace',
  '/app',
].filter((value): value is string => Boolean(value));

const REQUIRED_LOCAL_PATHS = ['src', 'api', 'server', 'public', 'index.html'];
const GITHUB_TOKEN_ENV_NAMES = [
  'SITE_BACKUP_GITHUB_TOKEN',
  'GITHUB_TOKEN',
  'GITHUB_PAT',
  'VERCEL_OIDC_TOKEN',
] as const;

const ROOT_FILES: string[] = [
  '.env.example',
  'AGENTS.md',
  'README.md',
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
  'playwright.config.ts',
  'vitest.config.ts',
  'vercel.json',
  '.gitignore',
  '.vercel/output/config.json',
  '.vercel/output/builds.json',
];

const CODE_ROOTS: CollectTarget[] = [
  { path: 'api', options: { includeNodeModules: false } },
  { path: 'src', options: { includeNodeModules: false } },
  { path: 'server', options: { includeNodeModules: false } },
  { path: 'public', options: { includeNodeModules: false } },
  { path: 'docs', options: { includeNodeModules: false } },
  { path: 'dist', options: { includeNodeModules: false } },
  { path: 'tests', options: { includeNodeModules: false } },
  { path: 'e2e', options: { includeNodeModules: false } },
  { path: 'tmp', options: { includeNodeModules: false } },
  { path: 'scripts', options: { includeNodeModules: false } },
  { path: 'GHL', options: { includeNodeModules: false } },
  { path: '.bolt', options: { includeNodeModules: false } },
  {
    path: '.vercel/output/functions',
    options: {
      includeNodeModules: false,
      includeOnly: (relPath: string): boolean => {
        return /\.(js|mjs|cjs|json|map|txt|md|ts|css|html)$/i.test(relPath);
      },
    },
  },
  {
    path: '.vercel/output/diagnostics',
    options: {
      includeNodeModules: false,
      includeOnly: (relPath: string): boolean => {
        return /\.(log|txt|json|toml)$/i.test(relPath) || relPath.endsWith('/diagnostics');
      },
    },
  },
];

const FILES_ROOTS: CollectTarget[] = [{ path: 'GHL/steamzone.ca/data/training' }];

const SKIP_DIRECTORIES = new Set(['.git', 'node_modules']);
const SKIP_ROOT_FILES = new Set(['steamzone-project.zip', '.DS_Store']);
const SKIP_PATH_FRAGMENTS = ['/dist/server/', '/.github/workflows/'];
type RepoCandidate = {
  owner: string;
  repo: string;
};

function normalizeDbMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown database error.';
}

function shouldSkipRelativePath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  return SKIP_PATH_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function getNormalizedCandidateValues(...values: Array<string | undefined | null>): string[] {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}

function pickEnvToken(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function parseRepoFromComposite(candidate: string): RepoCandidate | null {
  const value = candidate.trim();
  if (!value) {
    return null;
  }

  if (value.includes('/')) {
    const compact = value.replace(/\.git$/i, '').replace(/^git\+/, '');
    if (/^https?:\/\//i.test(compact) || compact.startsWith('git@') || compact.startsWith('ssh://')) {
      const normalized = compact
        .replace(/^https?:\/\/[^/]+\/|^ssh:\/\/[^/]+\/|^git@[^:]+:/, 'https://placeholder/');
      const parsed = new URL(normalized);
      const parts = parsed.pathname.replace(/^\//, '').split('/').filter(Boolean);
      if (parts.length >= 2) {
        return { owner: parts[0], repo: parts[1] };
      }
    }

    const rawParts = compact.split('/');
    if (rawParts.length >= 2 && !rawParts[0].includes(':') && !rawParts[0].includes('@')) {
      return {
        owner: rawParts[0],
        repo: rawParts.slice(1).join('/').replace(/\.git$/i, ''),
      };
    }
  }

  return null;
}

function parseGitRemoteUrl(url: string): RepoCandidate | null {
  const normalized = url.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith('git@')) {
    const atIndex = normalized.indexOf(':');
    if (atIndex === -1) {
      return null;
    }

    const path = normalized.slice(atIndex + 1).replace(/\.git$/i, '');
    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1] };
    }

    return null;
  }

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized);
      if (parsed.hostname.endsWith('github.com')) {
        const parts = parsed.pathname.replace(/^\//, '').replace(/\.git$/i, '').split('/').filter(Boolean);
        if (parts.length >= 2) {
          return { owner: parts[0], repo: parts[1] };
        }
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function resolveRepoFromGitConfig(projectRoot: string): Promise<RepoCandidate | null> {
  const configPathCandidates = [
    path.join(projectRoot, '.git', 'config'),
    path.join(process.cwd(), '.git', 'config'),
    '/workspace/default/.git/config',
    '/var/task/.git/config',
  ];

  for (const configPath of configPathCandidates) {
    try {
      const contents = await fs.readFile(configPath, 'utf8');
      const remoteBlocks = contents.split(/^\[remote /m);
      for (const block of remoteBlocks) {
        if (!/\"origin\"/.test(block)) {
          continue;
        }

        const urlMatch = block.match(/^\s*url\s*=\s*([^\r\n]+)/m);
        if (urlMatch) {
          const parsed = parseGitRemoteUrl(urlMatch[1]);
          if (parsed) {
            return parsed;
          }
        }

        const githubRepo = block.match(/^\s*github\.com[:/](.+)$/m);
        if (githubRepo) {
          const parsed = parseRepoFromComposite(githubRepo[0]);
          if (parsed) {
            return parsed;
          }
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function resolveGitHubSnapshotConfig(projectRoot: string): Promise<GitHubSnapshotConfig | null> {
  const provider = process.env.VERCEL_GIT_PROVIDER || process.env.GIT_PROVIDER || '';
  if (provider && provider.toLowerCase() !== 'github') {
    return null;
  }
  const owner = getNormalizedCandidateValues(
    process.env.VERCEL_GIT_REPO_OWNER,
    process.env.VERCEL_GIT_ORG,
    process.env.GIT_OWNER,
    process.env.GIT_OWNER_NAME,
    process.env.GITHUB_OWNER,
    process.env.GITHUB_REPOSITORY_OWNER,
    process.env.SITE_BACKUP_GITHUB_OWNER
  )[0];
  const repoFromEnv = getNormalizedCandidateValues(
    process.env.VERCEL_GIT_REPO_SLUG,
    process.env.VERCEL_GIT_REPO_NAME,
    process.env.VERCEL_GIT_REPOSITORY_SLUG,
    process.env.GITHUB_REPOSITORY_NAME,
    process.env.GITHUB_REPO,
    process.env.SITE_BACKUP_GITHUB_REPO,
    process.env.SITE_BACKUP_GITHUB_REPOSITORY
  )[0];
  const repoFromComposite = getNormalizedCandidateValues(
    process.env.GITHUB_REPOSITORY_URL,
    process.env.GIT_URL,
    process.env.SITE_BACKUP_GITHUB_URL,
    process.env.GITHUB_REPOSITORY,
    process.env.SITE_BACKUP_GITHUB_REPOSITORY_ID
  )[0];
  const gitRef = getNormalizedCandidateValues(
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.VERCEL_GIT_COMMIT_REF,
    process.env.GITHUB_SHA,
    process.env.REPO_REF,
    process.env.SITE_BACKUP_GITHUB_REF,
    process.env.SITE_BACKUP_GIT_REF,
    'main'
  )[0] ?? 'main';

  let resolvedRepo: RepoCandidate | null = null;
  if (owner && repoFromEnv) {
    resolvedRepo = { owner, repo: repoFromEnv };
  } else if (repoFromComposite) {
    resolvedRepo = parseRepoFromComposite(repoFromComposite);
  }

  if (!resolvedRepo) {
    // Best-effort fallback to local git config (works on environments where this is available).
    // Useful when env vars are trimmed and remote checkout metadata is preserved.
    resolvedRepo = await resolveRepoFromGitConfig(projectRoot);
  }

  if (!resolvedRepo) {
    return null;
  }

  return {
    owner: resolvedRepo.owner,
    repo: resolvedRepo.repo,
    ref: gitRef,
    token: pickEnvToken(GITHUB_TOKEN_ENV_NAMES),
    fallbackUrl: `https://api.github.com/repos/${encodeURIComponent(resolvedRepo.owner)}/${encodeURIComponent(
      resolvedRepo.repo
    )}/zipball/${encodeURIComponent(gitRef)}`,
  };
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

async function fileExists(entry: string): Promise<boolean> {
  try {
    await fs.access(entry);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(entry: string): Promise<boolean> {
  try {
    const stats = await fs.stat(entry);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

function gatherCandidateRoots(baseRoot: string): string[] {
  const candidates = new Set<string>([...PROJECT_ROOT_HINTS]);

  let depthWalk = baseRoot;
  for (let depth = 0; depth <= MAX_PROJECT_SEARCH_DEPTH; depth += 1) {
    candidates.add(depthWalk);
    const parent = path.dirname(depthWalk);
    if (parent === depthWalk) {
      break;
    }
    depthWalk = parent;
  }

  return Array.from(candidates).map((value) => path.resolve(value));
}

function hasProjectMarker(entry: string, marker: string): Promise<boolean> {
  return fileExists(path.join(entry, marker));
}

async function looksLikeProjectRoot(entry: string): Promise<boolean> {
  if (!(await hasProjectMarker(entry, 'package.json'))) {
    return false;
  }

  let found = 0;
  for (const marker of PROJECT_MARKERS) {
    if (marker === 'package.json') {
      continue;
    }

    if (await isDirectory(path.join(entry, marker))) {
      found += 1;
    }
  }

  if ((await fileExists(path.join(entry, 'index.html')))) {
    found += 1;
  }

  return found >= 2;
}

async function resolveProjectRoot(): Promise<{ root: string; candidates: string[] }> {
  const candidates = gatherCandidateRoots(process.cwd());

  for (const candidate of candidates) {
    if (await looksLikeProjectRoot(candidate)) {
      return { root: candidate, candidates };
    }
  }

  return { root: process.cwd(), candidates };
}

function shouldSkipByType(absPath: string, relPath: string): boolean {
  if (SKIP_ROOT_FILES.has(path.basename(absPath))) {
    return true;
  }

  if (relPath.includes('/.next/') || relPath.includes('/.output/') || relPath.includes('/.idea/')) {
    return true;
  }

  return false;
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

function buildRemoteFallbackError(code: string, message: string): string {
  return `${code}: ${message}`;
}

async function addFileToZip(
  zip: JSZip,
  relPath: string,
  data: Buffer,
  manifest: BackupManifest['includedFiles'],
  fileCount: { total: number; skipped: number; bytes: number },
  recordedPaths: Set<string>,
  source: 'local' | 'remote'
): Promise<void> {
  const normalized = normalizeZipPath(relPath);
  if (shouldSkipRelativePath(normalized) || shouldSkipByType(normalized, normalized)) {
    manifest.skippedReasons.push(`Skipped by path policy (${source}): ${normalized}`);
    fileCount.skipped += 1;
    return;
  }

  if (recordedPaths.has(normalized)) {
    manifest.skippedReasons.push(`Skipped duplicate file (${source}): ${normalized}`);
    fileCount.skipped += 1;
    return;
  }

  if (data.byteLength > MAX_FILE_BYTES) {
    manifest.skippedReasons.push(`Skipped large file (${data.byteLength} bytes) (${source}): ${normalized}`);
    fileCount.skipped += 1;
    return;
  }

  zip.file(`site/${normalized}`, data);
  recordedPaths.add(normalized);
  fileCount.total += 1;
  fileCount.bytes += data.byteLength;
}

async function addRemoteArchiveToZip(
  zip: JSZip,
  config: GitHubSnapshotConfig,
  manifest: BackupManifest['includedFiles'],
  fileCount: { total: number; skipped: number; bytes: number },
  recordedPaths: Set<string>
): Promise<string | null> {
  const headers: Record<string, string> = {
    'User-Agent': 'steamzone-backup/1.0',
    Accept: 'application/vnd.github+json',
  };

  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
    headers['X-GitHub-Api-Version'] = '2022-11-28';
  }

  let response: Response;
  try {
    response = await fetch(config.fallbackUrl, { headers });
  } catch (error) {
    return buildRemoteFallbackError('FETCH_ERROR', `Unable to fetch remote archive: ${normalizeDbMessage(error)}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => 'unknown response body');
    return buildRemoteFallbackError(
      'REMOTE_HTTP_ERROR',
      `GitHub returned ${response.status} ${response.statusText}: ${detail.slice(0, 200)}`
    );
  }

  const remoteBytes = Buffer.from(await response.arrayBuffer());
  let remoteZip: JSZip;
  try {
    remoteZip = await JSZip.loadAsync(remoteBytes);
  } catch (error) {
    return buildRemoteFallbackError('ZIP_PARSE_ERROR', `Unable to read remote archive: ${normalizeDbMessage(error)}`);
  }

  const entryNames = Object.keys(remoteZip.files).filter((name) => !remoteZip.files[name].dir);
  if (entryNames.length === 0) {
    return buildRemoteFallbackError('EMPTY_REMOTE_ARCHIVE', 'Remote zip had no files to process.');
  }

  const firstName = entryNames[0];
  const firstSlashIndex = firstName.indexOf('/');
  const rootPrefix = firstSlashIndex > 0 ? firstName.slice(0, firstSlashIndex + 1) : '';

  for (const entryName of entryNames) {
    let relativePath = normalizeZipPath(entryName);
    if (rootPrefix && relativePath.startsWith(rootPrefix)) {
      relativePath = relativePath.slice(rootPrefix.length);
    }

    if (!relativePath || relativePath.startsWith('.git/') || relativePath.startsWith('__MACOSX/')) {
      manifest.skippedReasons.push(`Skipped remote metadata/path: ${relativePath || entryName}`);
      fileCount.skipped += 1;
      continue;
    }

    if (relativePath.startsWith('.github/workflows/')) {
      manifest.skippedReasons.push(`Skipped remote workflow path: ${relativePath}`);
      fileCount.skipped += 1;
      continue;
    }

    try {
      const data = await remoteZip.files[entryName].async('nodebuffer');
      await addFileToZip(zip, relativePath, data, manifest, fileCount, recordedPaths, 'remote');
    } catch (error) {
      fileCount.skipped += 1;
      manifest.skippedReasons.push(`Unable to read remote file ${relativePath}: ${normalizeDbMessage(error)}`);
    }
  }

  return null;
}

async function addDirectoryToZip(
  zip: JSZip,
  absRoot: string,
  relRoot: string,
  manifest: BackupManifest['includedFiles'],
  fileCount: { total: number; skipped: number; bytes: number },
  recordedPaths: Set<string>,
  options: DirectoryOptions = { includeNodeModules: false }
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
        if (!options.includeNodeModules && entry.name === 'node_modules') {
          manifest.skippedReasons.push(`Skipped directory by policy: ${relPath}`);
          fileCount.skipped += 1;
          continue;
        }

        await addDirectoryToZip(zip, absPath, relPath, manifest, fileCount, recordedPaths, options);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (options.includeOnly && !options.includeOnly(relPath, absPath)) {
        manifest.skippedReasons.push(`Skipped by collector rule: ${relPath}`);
        fileCount.skipped += 1;
        continue;
      }

      if (shouldSkipByType(absPath, relPath)) {
        manifest.skippedReasons.push(`Skipped by file type policy: ${relPath}`);
        fileCount.skipped += 1;
        continue;
      }

      if (SKIP_ROOT_FILES.has(entry.name)) {
        manifest.skippedReasons.push(`Skipped archive marker by name: ${relPath}`);
        fileCount.skipped += 1;
        continue;
      }

      try {
        const data = await fs.readFile(absPath);
        await addFileToZip(zip, relPath, data, manifest, fileCount, recordedPaths, 'local');
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

  const { root: projectRoot, candidates } = await resolveProjectRoot();
  const manifest: BackupManifest = {
    generatedAt: new Date().toISOString(),
    requestedBy: 'admin',
    includeDatabase,
    candidateRoots: candidates,
    resolvedRoot: projectRoot,
    projectRoot,
    sourceMode: 'local',
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
  const recordedPaths = new Set<string>();
  const projectAwareFiles = FILES_ROOTS.concat(CODE_ROOTS).filter((entry) => Boolean(entry.path));
  const foundTargets = new Set<string>();
  const remoteConfig = await resolveGitHubSnapshotConfig(projectRoot);
  let usedRemoteFallback = false;
  let remoteFallbackError: string | null = null;

  for (const entry of ROOT_FILES) {
    const abs = path.join(projectRoot, entry);
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
      if (REQUIRED_LOCAL_PATHS.includes(entry)) {
        foundTargets.add(entry);
      }
      await addFileToZip(zip, entry, data, manifest.includedFiles, fileCount, recordedPaths, 'local');
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        manifest.includedFiles.skippedReasons.push(`Root file read error ${entry}: ${normalizeDbMessage(error)}`);
      }
      fileCount.skipped += 1;
    }
  }

  for (const target of projectAwareFiles) {
    const absRoot = path.join(projectRoot, target.path);
    const targetOptions = target.options ? target.options : { includeNodeModules: false };
    const options = {
      includeNodeModules: targetOptions.includeNodeModules,
      includeOnly: targetOptions.includeOnly,
    };

    try {
      const stats = await fs.stat(absRoot);
      if (!stats.isDirectory()) {
        manifest.includedFiles.skippedReasons.push(`Path is not a directory: ${target.path}`);
        fileCount.skipped += 1;
        continue;
      }
      foundTargets.add(target.path);
      await addDirectoryToZip(zip, absRoot, target.path, manifest.includedFiles, fileCount, recordedPaths, options);
    } catch {
      manifest.includedFiles.skippedReasons.push(`Directory not found: ${target.path}`);
      fileCount.skipped += 1;
    }
  }

  const missingExpectedPaths = REQUIRED_LOCAL_PATHS.filter((pathName) => !foundTargets.has(pathName));
  if (missingExpectedPaths.length > 0) {
    if (remoteConfig) {
      manifest.includedFiles.skippedReasons.push(
        `Local snapshot appears partial; attempting remote fallback for missing: ${missingExpectedPaths.join(', ')}`
      );
      const error = await addRemoteArchiveToZip(zip, remoteConfig, manifest.includedFiles, fileCount, recordedPaths);
      if (error) {
        remoteFallbackError = error;
        manifest.includedFiles.skippedReasons.push(`Remote fallback failed: ${error}`);
      } else {
        usedRemoteFallback = true;
      }
    } else {
      manifest.includedFiles.skippedReasons.push(
        `Local snapshot appears partial: missing ${missingExpectedPaths.join(', ')}. Set SITE_BACKUP_SOURCE_ROOT to a full repo path.`
      );
    }
  }

  manifest.sourceMode = usedRemoteFallback ? 'local-and-remote-fallback' : 'local';
  if (remoteFallbackError) {
    manifest.includedFiles.skippedReasons.push(`Remote fallback warning: ${remoteFallbackError}`);
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
