// Classifies project-relative path risk without depending on host filesystem or old packages.
export const protectedProjectPaths = {
  directories: ['.git', '.vscode', '.idea', '.husky', '.megumi', 'node_modules'],
  files: ['.gitconfig', '.gitmodules', '.ripgreprc', '.mcp.json', '.megumi.json'],
} as const;

export const sensitiveProjectPathPatterns = [
  '.env',
  '.env.*',
  'secrets/**',
  '*.pem',
  '*.key',
  'id_rsa',
  'id_ed25519',
] as const;

export type ProjectPathRiskLevel = 'ordinary' | 'protected' | 'sensitive' | 'project_escape';

export interface ProjectPathRiskClassification {
  level: ProjectPathRiskLevel;
  reasons: string[];
  normalizedPath: string;
}

export function classifyProjectPathRisk(targetPath: string | undefined): ProjectPathRiskClassification {
  const normalizedPath = normalizeProjectPath(targetPath ?? '');

  if (isProjectEscape(targetPath ?? '')) {
    return { level: 'project_escape', reasons: ['project_escape'], normalizedPath };
  }
  if (isProtectedProjectPath(normalizedPath)) {
    return { level: 'protected', reasons: ['protected_path'], normalizedPath };
  }
  if (isSensitiveProjectPath(normalizedPath)) {
    return { level: 'sensitive', reasons: ['sensitive_path'], normalizedPath };
  }

  return { level: 'ordinary', reasons: ['ordinary_path'], normalizedPath };
}

export function isProtectedOrSensitiveProjectPath(targetPath: string): boolean {
  const risk = classifyProjectPathRisk(targetPath);
  return risk.level === 'protected' || risk.level === 'sensitive' || risk.level === 'project_escape';
}

function isProjectEscape(value: string): boolean {
  const normalized = value.replaceAll('\\', '/').trim();
  return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..');
}

function isProtectedProjectPath(relativePath: string): boolean {
  const firstSegment = relativePath.split('/')[0] ?? '';
  return protectedProjectPaths.directories.includes(firstSegment as never)
    || protectedProjectPaths.files.includes(relativePath as never);
}

function isSensitiveProjectPath(relativePath: string): boolean {
  const segments = relativePath.split('/').filter(Boolean);
  const basename = segments.at(-1) ?? relativePath;

  return basename === '.env'
    || basename.startsWith('.env.')
    || basename.endsWith('.pem')
    || basename.endsWith('.key')
    || basename === 'id_rsa'
    || basename === 'id_ed25519'
    || segments.includes('secrets')
    || sensitiveProjectPathPatterns.some((pattern) => globToRegExp(pattern).test(relativePath));
}

function normalizeProjectPath(value: string): string {
  return value
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .toLowerCase();
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
