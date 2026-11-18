import React from 'react';
import ReactMarkdown from 'react-markdown';
import { markdownConfig } from './config/markdownConfig';



const StreamingMarkdownConfig = ({ content }:{content: string}) => {
  return (
    <ReactMarkdown
      remarkPlugins={markdownConfig.remarkPlugins}
      rehypePlugins={markdownConfig.rehypePlugins}
      components={markdownConfig.components}
      urlTransform={markdownConfig.urlTransform}
    >
      {content}
    </ReactMarkdown>
  );
};

export default StreamingMarkdownConfig;
