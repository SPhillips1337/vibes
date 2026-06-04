import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, extname, relative } from 'path';
import { log } from '../logger.js';

export interface AuditIssue {
  type: 'import' | 'css_orphan' | 'syntax' | 'prop_mismatch' | 'dead_code';
  file: string;
  message: string;
}

const IMPORT_RE = /(?:from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;
const IMPORT_RE_EXPORT = /export\s+\{[^}]*\}\s*from\s+['"]([^'"]+)['"]/g;
const CSS_IMPORT_RE = /import\s+['"]([^'"]+\.css)['"]/g;

const EXT_ORDER = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];

function resolveImportPath(baseDir: string, importPath: string): string | null {
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    return null;
  }
  const resolved = resolve(baseDir, importPath);
  if (existsSync(resolved) && statSync(resolved).isFile()) return resolved;
  for (const ext of EXT_ORDER) {
    const withExt = resolved + ext;
    if (existsSync(withExt)) return withExt;
  }
  const indexDir = join(resolved, 'index');
  for (const ext of EXT_ORDER) {
    const indexPath = indexDir + ext;
    if (existsSync(indexPath)) return indexPath;
  }
  return null;
}

function collectFiles(root: string, extensions: string[]): string[] {
  const result: string[] = [];
  function walk(dir: string) {
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (entry.startsWith('.') || entry === 'node_modules') continue;
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (extensions.includes(extname(full))) {
          result.push(full);
        }
      }
    } catch { }
  }
  walk(root);
  return result;
}

export function runStructuralAudit(workspaceRoot: string, taskFiles: string[]): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const srcDir = join(workspaceRoot, 'src');

  if (!existsSync(srcDir)) {
    log('Structural audit: no src/ directory found, skipping', 'DEBUG');
    return [];
  }

  const tsFiles = collectFiles(srcDir, ['.ts', '.tsx', '.js', '.jsx']);
  const cssFiles = collectFiles(srcDir, ['.css']);

  const importedCssFiles = new Set<string>();

  for (const file of tsFiles) {
    const content = readFileSync(file, 'utf8');
    const relFile = relative(workspaceRoot, file);

    // Extract all import paths
    const importPaths: string[] = [];
    let m: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(content)) !== null) {
      importPaths.push(m[1]);
    }
    IMPORT_RE_EXPORT.lastIndex = 0;
    while ((m = IMPORT_RE_EXPORT.exec(content)) !== null) {
      importPaths.push(m[1]);
    }
    CSS_IMPORT_RE.lastIndex = 0;
    while ((m = CSS_IMPORT_RE.exec(content)) !== null) {
      importedCssFiles.add(resolve(dirname(file), m[1]));
    }

    for (const imp of importPaths) {
      if (!imp.startsWith('.')) continue;
      const resolved = resolveImportPath(dirname(file), imp);
      if (!resolved) {
        issues.push({
          type: 'import',
          file: relFile,
          message: `Unresolved import: "${imp}"`,
        });
      }
    }

    // Static + Dynamic (lazy) import check
    const staticImports = new Set<string>();
    const staticImportRegex = /import\s+[\s\S]*?from\s+['"]([^'"]+)['"]/g;
    let staticMatch: RegExpExecArray | null;
    while ((staticMatch = staticImportRegex.exec(content)) !== null) {
      const resolved = resolveImportPath(dirname(file), staticMatch[1]);
      if (resolved) {
        staticImports.add(resolved);
      }
    }

    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let dynamicMatch: RegExpExecArray | null;
    while ((dynamicMatch = dynamicImportRegex.exec(content)) !== null) {
      const resolved = resolveImportPath(dirname(file), dynamicMatch[1]);
      if (resolved && staticImports.has(resolved)) {
        issues.push({
          type: 'import',
          file: relFile,
          message: `File is both statically and dynamically/lazily imported: "${dynamicMatch[1]}". This eagerly bundles the component, defeating the purpose of lazy loading.`,
        });
      }
    }

    // Style check 1: React inline style pseudo-selectors/pseudo-elements
    const pseudoStyleRegex = /['"](::?|@)[a-zA-Z-]+['"]\s*:/g;
    let pseudoMatch: RegExpExecArray | null;
    while ((pseudoMatch = pseudoStyleRegex.exec(content)) !== null) {
      issues.push({
        type: 'prop_mismatch',
        file: relFile,
        message: `React inline styles do not support pseudo-elements, pseudo-classes, or media queries (found "${pseudoMatch[1]}"). Use standard CSS or style injection.`,
      });
    }

    // Style check 2: Spreading 'style' directly onto JSX elements
    if (/<[A-Za-z0-9_]+\s+[^>]*?\{\.\.\.style\}/.test(content)) {
      issues.push({
        type: 'prop_mismatch',
        file: relFile,
        message: `JSX element spreads the 'style' object directly onto the element (i.e. {...style}). This spreads style properties as React props instead of applying them to the style attribute. Use style={style} or style={{ ...style }}.`,
      });
    }

    // React.forwardRef signature/usage check
    const forwardRefMatch = content.match(/(?:React\.)?forwardRef\s*\(\s*(\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/);
    if (forwardRefMatch) {
      const paramsText = forwardRefMatch[1];
      const params = paramsText.replace(/[()]/g, '').split(',').map(p => p.trim());
      if (params.length < 2) {
        issues.push({
          type: 'syntax',
          file: relFile,
          message: `React.forwardRef drops the 'ref' parameter. The callback signature must accept two arguments: (props, ref).`,
        });
      } else {
        const refName = params[1];
        const escapedRefName = refName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const refUsageRegex = new RegExp(`\\b${escapedRefName}\\b`, 'g');
        const matches = content.match(refUsageRegex);
        if (matches && matches.length === 1) {
          issues.push({
            type: 'syntax',
            file: relFile,
            message: `React.forwardRef is used but the 'ref' parameter ("${refName}") is unused in the component body.`,
          });
        }
      }
    }

    // Syntax check: Try to detect basic issues (unbalanced braces)
    let braceDepth = 0;
    let inStr = false;
    let escaped = false;
    let inTmpl = false;
    let syntaxError = false;
    for (let i = 0; i < content.length; i++) {
      const ch = content[i];
      if (ch === '\\' && !escaped) { escaped = true; continue; }
      if (ch === '"' || ch === "'") {
        if (!inStr && !inTmpl) { inStr = true; }
        else if (inStr && !escaped) { inStr = false; }
      }
      if (ch === '`' && !inStr && !escaped) inTmpl = !inTmpl;
      if (!inStr && !inTmpl) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
        if (braceDepth < 0) { syntaxError = true; break; }
      }
      escaped = false;
    }
    if (syntaxError || braceDepth !== 0) {
      issues.push({
        type: 'syntax',
        file: relFile,
        message: syntaxError ? 'Unmatched closing brace' : `Unclosed braces (depth: ${braceDepth})`,
      });
    }
  }

  // CSS orphan detection
  for (const cssFile of cssFiles) {
    if (!importedCssFiles.has(cssFile)) {
      issues.push({
        type: 'css_orphan',
        file: relative(workspaceRoot, cssFile),
        message: 'CSS file is not imported by any component',
      });
    }
  }

  if (issues.length > 0) {
    log(`Structural audit found ${issues.length} issue(s)`, 'WARN');
    for (const issue of issues) {
      log(`  [${issue.type}] ${issue.file}: ${issue.message}`, 'WARN');
    }
  } else {
    log('Structural audit passed — no issues found', 'INFO');
  }

  return issues;
}
