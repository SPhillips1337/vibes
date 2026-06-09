const content = `const Skeleton: React.FC<SkeletonProps> = ({
  shape = 'rect',
}) => {
  const shapeClass = shape === 'circle' ? 'skeleton-circle' : 'skeleton-rect';
  return (
    <div className={\`skeleton \${shapeClass} \${className}\`} style={combinedStyle}>
    </div>
  );
};`;

let braceDepth = 0;
let inLineComment = false;
let inBlockComment = false;
let inStr = false;
let stringChar = '';
let inTmpl = false;
const templateBraces = [];
let escaped = false;
let syntaxError = false;

for (let i = 0; i < content.length; i++) {
  const ch = content[i];
  const nextCh = content[i + 1] || '';

  if (escaped) {
    escaped = false;
    continue;
  }
  if (ch === '\\\\' && (inStr || inTmpl)) {
    escaped = true;
    continue;
  }
  if (inStr) {
    if (ch === stringChar) inStr = false;
    continue;
  }
  if (inTmpl) {
    if (ch === '\`') {
      inTmpl = false;
      if (templateBraces.length > 0) {
        braceDepth += templateBraces.pop();
      }
    } else if (ch === '$' && nextCh === '{') {
      templateBraces.push(braceDepth);
      braceDepth = 0;
      i++;
      continue;
    }
  }
  if (!inStr && !inTmpl) {
    if (ch === '"' || ch === "'") {
      inStr = true;
      stringChar = ch;
      continue;
    }
    if (ch === '\`') {
      inTmpl = true;
      continue;
    }
  }

  const inTemplateString = inTmpl && templateBraces.length === 0;
  if (!inStr && !inLineComment && !inBlockComment && !inTemplateString) {
    if (ch === '{') {
      braceDepth++;
      console.log(`{ found at ${i}, depth=${braceDepth}, inTmpl=${inTmpl}, tempBraces=${templateBraces}`);
    } else if (ch === '}') {
      braceDepth--;
      console.log(`} found at ${i}, depth=${braceDepth}, inTmpl=${inTmpl}, tempBraces=${templateBraces}`);
      if (braceDepth < 0) {
        if (templateBraces.length > 0) {
          braceDepth = templateBraces.pop();
          console.log(`  popped tempBraces, depth=${braceDepth}`);
        } else {
          syntaxError = true;
          break;
        }
      }
    }
  }
}
const finalBraceDepth = braceDepth + templateBraces.reduce((a, b) => a + b, 0);
console.log('Depth:', finalBraceDepth);