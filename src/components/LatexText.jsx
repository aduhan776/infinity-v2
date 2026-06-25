import React from 'react';
import katex from 'katex';

const LatexText = ({ text }) => {
  if (!text) return null;

  // String ko '$' symbol ke basis par split karega math parse karne ke liye
  const parts = text.split('$');

  return (
    // whiteSpace: 'pre-wrap' lagane se saare \n\n asli line breaks ban jayenge
    <span style={{ whiteSpace: 'pre-wrap', display: 'inline-block', width: '100%' }}>
      {parts.map((part, index) => {
        if (index % 2 !== 0) {
          try {
            const html = katex.renderToString(part, { throwOnError: false });
            return <span key={index} dangerouslySetInnerHTML={{ __html: html }} />;
          } catch (err) {
            return <span key={index}>{part}</span>;
          }
        }
        return <span key={index}>{part}</span>;
      })}
    </span>
  );
};

export default LatexText;