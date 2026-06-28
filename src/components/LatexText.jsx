import React from 'react';
import katex from 'katex';

const LatexText = ({ text }) => {
  if (!text) return null;

  // 🚨 ROBUST MATCHING BOUNDARY: Strict paired expressions filtering pattern prevents currency line crashes
  const tokens = text.split(/(\$[^\$]+\$)/g);

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