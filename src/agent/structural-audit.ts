import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, extname, relative, sep } from 'path';
import { log } from '../logger.js';
import { detectTechStack } from './tech-stack.js';

export interface AuditIssue {
  type: 'import' | 'css_orphan' | 'syntax' | 'prop_mismatch' | 'dead_code';
  file: string;
  message: string;
}

const IMPORT_RE = /(?:from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;
const IMPORT_RE_EXPORT = /export\s+\{[^}]*\}\s*from\s+['"]([^'"]+)['"]/g;
const CSS_IMPORT_RE = /import\s+['"]([^'"]+\.css)['"]/g;

const EXT_ORDER = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];

function resolveImportPath(baseDir: string, importPath: string, workspaceRoot?: string): string | null {
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    return null;
  }
  const resolved = resolve(baseDir, importPath);

  // Guard: prevent path traversal outside the workspace root.
  // A malicious repo could embed `import foo from '../../../../etc/passwd'`.
  if (workspaceRoot) {
    const root = resolve(workspaceRoot) + sep;
    if (!resolved.startsWith(root)) return null;
  }

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
        if (entry.startsWith('.') || entry === 'node_modules' || entry === 'venv' || entry === 'dist' || entry === 'build') continue;
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

function getDefinitionBraceDepth(content: string, identifier: string): number | null {
  let braceDepth = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inStr = false;
  let stringChar = '';
  let inTmpl = false;
  const templateBraces: number[] = [];
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const nextCh = content[i + 1] || '';

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && nextCh === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (ch === '\\' && (inStr || inTmpl)) {
      escaped = true;
      continue;
    }

    if (inStr) {
      if (ch === stringChar) inStr = false;
      continue;
    }

    if (inTmpl) {
      if (ch === '`') {
        inTmpl = false;
        // Restore the brace depth saved when this template literal began.
        // Without this, any depth pushed onto templateBraces before the opening
        // backtick is orphaned and causes a false "Unclosed braces" report.
        if (templateBraces.length > 0) {
          braceDepth += templateBraces.pop()!;
        }
      } else if (ch === '$' && nextCh === '{') {
        templateBraces.push(braceDepth);
        braceDepth = 0;
        i++;
        continue;
      }
    }

    if (!inStr && !inTmpl) {
      if (ch === '/' && nextCh === '/') {
        inLineComment = true;
        i++;
        continue;
      }
      if (ch === '/' && nextCh === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = true;
        stringChar = ch;
        continue;
      }
      if (ch === '`') {
        inTmpl = true;
        continue;
      }
    }

    const inTemplateString = inTmpl && templateBraces.length === 0;
    if (!inStr && !inLineComment && !inBlockComment && !inTemplateString) {
      const remaining = content.substring(i);
      const declMatch = remaining.match(/^(const|let|var|function|class)\s+([a-zA-Z0-9_$]+)\b/);
      if (declMatch && declMatch[2] === identifier) {
        return braceDepth + templateBraces.reduce((a, b) => a + b, 0);
      }

      if (ch === '{') {
        braceDepth++;
      } else if (ch === '}') {
        braceDepth--;
        if (braceDepth < 0) {
          if (templateBraces.length > 0) {
            braceDepth = templateBraces.pop()!;
          } else {
            break;
          }
        }
      }
    }
  }

  return null;
}

export function runStructuralAudit(workspaceRoot: string, taskFiles: string[]): AuditIssue[] {
  const issues: AuditIssue[] = [];

  const stack = detectTechStack(workspaceRoot);
  log(`Structural audit: detected tech stack: ${stack.join(', ')}`, 'INFO');

  const srcDir = join(workspaceRoot, 'src');
  const auditDir = existsSync(srcDir) ? srcDir : workspaceRoot;

  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.css'];
  const files = collectFiles(auditDir, extensions);

  const importedCssFiles = new Set<string>();

  for (const file of files) {
    const ext = extname(file);
    if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
      const content = readFileSync(file, 'utf8');
      CSS_IMPORT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CSS_IMPORT_RE.exec(content)) !== null) {
        importedCssFiles.add(resolve(dirname(file), m[1]));
      }
    }
  }

  for (const file of files) {
    const ext = extname(file);
    const content = readFileSync(file, 'utf8');
    const relFile = relative(workspaceRoot, file);

    // 1. General JavaScript/TypeScript Checks
    if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
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

      for (const imp of importPaths) {
        if (!imp.startsWith('.')) continue;
        const resolved = resolveImportPath(dirname(file), imp, workspaceRoot);
        if (!resolved) {
          issues.push({
            type: 'import',
            file: relFile,
            message: `Unresolved import: "${imp}"`,
          });
        }
      }

      // Syntax check: Scan the file character-by-character to detect brace mismatch and nested createContext
      let braceDepth = 0;
      let inLineComment = false;
      let inBlockComment = false;
      let inStr = false;
      let stringChar = '';
      let inTmpl = false;
      const templateBraces: number[] = [];
      let escaped = false;
      let syntaxError = false;

      for (let i = 0; i < content.length; i++) {
        const ch = content[i];
        const nextCh = content[i + 1] || '';

        if (escaped) {
          escaped = false;
          continue;
        }

        if (inLineComment) {
          if (ch === '\n') inLineComment = false;
          continue;
        }

        if (inBlockComment) {
          if (ch === '*' && nextCh === '/') {
            inBlockComment = false;
            i++;
          }
          continue;
        }

        if (ch === '\\' && (inStr || inTmpl)) {
          escaped = true;
          continue;
        }

        if (inStr) {
          if (ch === stringChar) inStr = false;
          continue;
        }

        if (inTmpl) {
          if (ch === '`') {
            inTmpl = false;
            // Restore the brace depth saved when this template literal began.
            // Without this, any depth pushed onto templateBraces before the opening
            // backtick is orphaned and causes a false "Unclosed braces" report.
            if (templateBraces.length > 0) {
              braceDepth += templateBraces.pop()!;
            }
          } else if (ch === '$' && nextCh === '{') {
            templateBraces.push(braceDepth);
            braceDepth = 0;
            i++;
            continue;
          }
        }

        if (!inStr && !inTmpl) {
          if (ch === '/' && nextCh === '/') {
            inLineComment = true;
            i++;
            continue;
          }
          if (ch === '/' && nextCh === '*') {
            inBlockComment = true;
            i++;
            continue;
          }
          if (ch === '"' || ch === "'") {
            inStr = true;
            stringChar = ch;
            continue;
          }
          if (ch === '`') {
            inTmpl = true;
            continue;
          }
        }

        const inTemplateString = inTmpl && templateBraces.length === 0;
        if (!inStr && !inLineComment && !inBlockComment && !inTemplateString) {
          // Detect createContext (React-only)
          if (stack.includes('react')) {
            if (ch === 'c' && content.substring(i).startsWith('createContext')) {
              const after = content.substring(i + 'createContext'.length).trim();
              if (after.startsWith('(')) {
                const totalDepth = braceDepth + templateBraces.reduce((a, b) => a + b, 0);
                if (totalDepth > 0) {
                  issues.push({
                    type: 'syntax',
                    file: relFile,
                    message: `React.createContext() called inside a nested function or component (depth: ${totalDepth}). Contexts must be defined at the module scope to avoid re-creation on every render.`,
                  });
                }
              }
            }
          }

          if (ch === '{') {
            braceDepth++;
          } else if (ch === '}') {
            braceDepth--;
            if (braceDepth < 0) {
              if (templateBraces.length > 0) {
                braceDepth = templateBraces.pop()!;
              } else {
                syntaxError = true;
                break;
              }
            }
          }
        }
      }

      const finalBraceDepth = braceDepth + templateBraces.reduce((a, b) => a + b, 0);
      if (syntaxError || finalBraceDepth !== 0) {
        issues.push({
          type: 'syntax',
          file: relFile,
          message: syntaxError ? 'Unmatched closing brace' : `Unclosed braces (depth: ${finalBraceDepth})`,
        });
      }

      // 2. React Framework Checks
      if (stack.includes('react')) {
        // Static + Dynamic (lazy) import check
        const staticImports = new Set<string>();
        const staticImportRegex = /import\s+[\s\S]*?from\s+['"]([^'"]+)['"]/g;
        let staticMatch: RegExpExecArray | null;
        while ((staticMatch = staticImportRegex.exec(content)) !== null) {
          const resolved = resolveImportPath(dirname(file), staticMatch[1], workspaceRoot);
          if (resolved) {
            staticImports.add(resolved);
          }
        }

        const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
        let dynamicMatch: RegExpExecArray | null;
        while ((dynamicMatch = dynamicImportRegex.exec(content)) !== null) {
          const resolved = resolveImportPath(dirname(file), dynamicMatch[1], workspaceRoot);
          if (resolved && staticImports.has(resolved)) {
            issues.push({
              type: 'import',
              file: relFile,
              message: `File is both statically and dynamically/lazily imported: "${dynamicMatch[1]}". This eagerly bundles the component, defeating the purpose of lazy loading.`,
            });
          }
        }

        // React inline style pseudo-selectors/pseudo-elements
        const pseudoStyleRegex = /['"](::?|@)[a-zA-Z-]+['"]\s*:/g;
        let pseudoMatch: RegExpExecArray | null;
        while ((pseudoMatch = pseudoStyleRegex.exec(content)) !== null) {
          issues.push({
            type: 'prop_mismatch',
            file: relFile,
            message: `React inline styles do not support pseudo-elements, pseudo-classes, or media queries (found "${pseudoMatch[1]}"). Use standard CSS or style injection.`,
          });
        }

        // Spreading 'style' directly onto JSX elements
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

        // Context hook & scope verification
        const useContextRegex = /(?:React\.)?useContext\s*\(\s*([a-zA-Z0-9_$]+)\s*\)/g;
        let ucMatch: RegExpExecArray | null;
        while ((ucMatch = useContextRegex.exec(content)) !== null) {
          const identifier = ucMatch[1];
          const defDepth = getDefinitionBraceDepth(content, identifier);
          if (defDepth !== null && defDepth > 0) {
            issues.push({
              type: 'syntax',
              file: relFile,
              message: `React context "${identifier}" is referenced in useContext() but is defined inside a nested scope/function (brace depth: ${defDepth}). It must be defined at the module scope to be accessible.`,
            });
          }
        }
      }
    }

    // 3. Python Checks
    if (ext === '.py' && stack.includes('python')) {
      const mutableDefaultRegex = /def\s+[a-zA-Z0-9_]+\s*\([^)]*=[ \t]*(\[\]|\{\})/g;
      let pMatch: RegExpExecArray | null;
      while ((pMatch = mutableDefaultRegex.exec(content)) !== null) {
        issues.push({
          type: 'syntax',
          file: relFile,
          message: `Python function definition has a mutable default argument (${pMatch[1]}). This can lead to shared state bugs. Use 'None' as the default value instead.`,
        });
      }
    }

    // 4. CSS Checks
    if (ext === '.css' && (stack.includes('css') || stack.includes('javascript') || stack.includes('react'))) {
      if (!importedCssFiles.has(file)) {
        issues.push({
          type: 'css_orphan',
          file: relFile,
          message: 'CSS file is not imported by any component',
        });
      }

      // Strip CSS comments to avoid false matches in comments
      const cleanCss = content.replace(/\/\*[\s\S]*?\*\//g, '');
      if (/^\s*import\b/m.test(cleanCss)) {
        issues.push({
          type: 'syntax',
          file: relFile,
          message: 'CSS file uses JavaScript-style "import" syntax. Use CSS "@import" instead.',
        });
      }
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
