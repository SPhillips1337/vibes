const fs = require('fs');

const content = `import React from 'react';
import '../styles/skeleton.css';

export type SkeletonShape = 'rect' | 'circle';

interface SkeletonProps {
  shape?: SkeletonShape;
  className?: string;
  style?: React.CSSProperties;
  width?: number | string;
  height?: number | string;
  borderRadius?: number | string;
  children?: React.ReactNode;
}

const Skeleton: React.FC<SkeletonProps> = ({
  shape = 'rect',
  className = '',
  style,
  width = '100%',
  height = '100%',
  borderRadius,
  children,
}) => {
  const shapeClass = shape === 'circle' ? 'skeleton-circle' : 'skeleton-rect';

  const combinedStyle: React.CSSProperties = {
    ...style,
    width,
    height,
    borderRadius: shape === 'circle' ? undefined : borderRadius,
  };

  return (
    <div className={\`skeleton \${shapeClass} \${className}\`} style={combinedStyle}>
      {children}
    </div>
  );
};

export default Skeleton;
`;

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
    if (ch === '\`') {
      inTmpl = true;
      continue;
    }
  }

  const inTemplateString = inTmpl && templateBraces.length === 0;
  if (!inStr && !inLineComment && !inBlockComment && !inTemplateString) {
    if (ch === '{') {
      braceDepth++;
    } else if (ch === '}') {
      braceDepth--;
      if (braceDepth < 0) {
        if (templateBraces.length > 0) {
          braceDepth = templateBraces.pop();
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
