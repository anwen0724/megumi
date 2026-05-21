import path from 'node:path';

export const DEFAULT_PROTECTED_PATHS = {
  directories: ['.git', '.vscode', '.idea', '.husky', '.megumi'],
  files: ['.gitconfig', '.gitmodules', '.ripgreprc', '.mcp.json', '.megumi.json'],
} as const;

export const DEFAULT_SENSITIVE_PATHS = [
  '.env',
  '.env.*',
  'secrets/**',
  '*.pem',
  '*.key',
  'id_rsa',
  'id_ed25519',
] as const;

export interface ProjectPathClassificationInput {
  projectRoot: string;
  targetPath: string;
  platform?: NodeJS.Platform;
  protectedPathHints?: readonly string[];
}

export interface ProjectPathClassification {
  absolutePath: string;
  relativePath: string;
  insideProject: boolean;
  protected: boolean;
  sensitive: boolean;
}

export function classifyProjectPath(input: ProjectPathClassificationInput): ProjectPathClassification {
  const pathApi = pathApiForPlatform(input.platform ?? process.platform);
  const projectRoot = pathApi.resolve(input.projectRoot);
  const absolutePath = pathApi.resolve(projectRoot, input.targetPath);
  const relativePath = normalizePath(pathApi.relative(projectRoot, absolutePath));
  const insideProject = isInsideProject(relativePath, pathApi);

  return {
    absolutePath,
    relativePath,
    insideProject,
    protected: insideProject && isProtectedProjectPath(relativePath, input.protectedPathHints),
    sensitive: insideProject && isSensitiveProjectPath(relativePath),
  };
}

export function isProtectedProjectPath(
  relativePath: string,
  protectedPathHints: readonly string[] = [],
): boolean {
  const normalized = normalizePath(relativePath);
  const firstSegment = normalized.split('/')[0];

  return DEFAULT_PROTECTED_PATHS.directories.includes(firstSegment as never)
    || DEFAULT_PROTECTED_PATHS.files.includes(normalized as never)
    || protectedPathHints.some((hint) => matchesProtectedPathHint(normalized, hint));
}

export function isSensitiveProjectPath(relativePath: string): boolean {
  const normalized = normalizePath(relativePath);
  return DEFAULT_SENSITIVE_PATHS.some((pattern) => globToRegExp(pattern).test(normalized));
}

function pathApiForPlatform(platform: NodeJS.Platform): typeof path.win32 | typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function matchesProtectedPathHint(relativePath: string, hint: string): boolean {
  const normalizedHint = normalizePath(hint).replace(/^\/+|\/+$/g, '');
  return normalizedHint.length > 0
    && (relativePath === normalizedHint || relativePath.startsWith(`${normalizedHint}/`));
}

function isInsideProject(relativePath: string, pathApi: typeof path.win32 | typeof path.posix): boolean {
  return relativePath === ''
    || (relativePath !== '..' && !relativePath.startsWith('../') && !pathApi.isAbsolute(relativePath));
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === '*' && next === '*') {
      source += '.*';
      index += 1;
      continue;
    }

    if (char === '*') {
      source += '[^/]*';
      continue;
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}
