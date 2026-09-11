import React from 'react';
import katex from 'katex';

const LatexText = ({ text, compactSpacing = false }) => {
  if (!text) return null;

  // 🧹 Optional: collapse 2+ consecutive blank lines down to one. Some
  // AI-generated questions with numbered statements (1. ... 2. ... 3. ...)
  // come with extra blank lines between each, which — combined with
  // `pre-wrap` below — renders as very tall gaps. Only applied where the
  // caller opts in, so normal question rendering elsewhere is untouched.
  const normalizedText = compactSpacing ? text.replace(/\n{2,}/g, '\n\n') : text;

  // 🚨 ROBUST MATCHING BOUNDARY: Strict paired expressions filtering pattern prevents currency line crashes
  const tokens = normalizedText.split(/(\$[^\$]+\$)/g);

  return (
    <span style={{ whiteSpace: 'pre-wrap', display: 'inline-block', width: '100%' }}>
      {tokens.map((token, index) => {
        if (token.startsWith('$') && token.endsWith('$') && token.length > 2) {
          const rawMathExpression = token.slice(1, -1); // Extract inner syntax cleanly
          try {
            const html = katex.renderToString(rawMathExpression, { 
              throwOnError: false,
              trust: false // Restricts arbitrary external embedded components injections vectors
            });
            return <span key={index} dangerouslySetInnerHTML={{ __html: html }} />;
          } catch (err) {
            return <span key={index}>{token}</span>;
          }
        }
        return <span key={index}>{token}</span>;
      })}
    </span>
  );
};

export default LatexText;