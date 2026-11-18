import React, {useState} from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';           // 支持表格、任务列表等 GitHub Flavored Markdown
// import rehypeHighlight from 'rehype-highlight'; // 代码高亮
import rehypeKatex from 'rehype-katex';       // 数学公式
import 'katex/dist/katex.min.css';            // 必须引入 KaTeX 样式
// import 'highlight.js/styles/github.css';   // 浅色代码块主题
import remarkMath from 'remark-math';


const preStyle: React.CSSProperties = {
  background: '#f8f8f8',
  borderRadius: 6,
  padding: 12,
  overflowX: 'auto',
  fontFamily: '"JetBrains Mono","Fira Code","Cascadia Code","SF Mono",Menlo,Monaco,Consolas,"Courier New",monospace',
  fontSize: '0.88em',
  fontStyle: 'normal',
  margin: 0,
  border: "1px solid #efefef",
};

const codeStyle: React.CSSProperties = {
  fontFamily: 'inherit',
//   fontSize: 'inherit',
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'inherit',
  whiteSpace: 'pre',
//   color: '#4c4247',
//   background: "rgba(243, 244, 244)",
//   padding: "2px 5px",
  fontSize: "15px",
//   color: "rgba(51, 51, 51)",
};



interface CodeBlockProps {
  code: string;
  language?: string;
}
 
export function CodeBlock({
  code,
  language = "text"
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
 
  const lines = code.split("\n");
  const shouldCollapse = lines.length > 20;
  const visibleCode =
    shouldCollapse && !expanded
      ? lines.slice(0, 20).join("\n")
      : code;
 
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
 
      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      setCopied(false);
    }
  }
 
  return (
    <div className="code-block">
      <div className="code-block__header">
        <span>{language}</span>
 
        <button
          type="button"
          onClick={handleCopy}
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
 
      <pre  className="code-block__content" style={preStyle}>
        <code style={codeStyle}>{visibleCode}</code>
      </pre>
 
      {shouldCollapse && (
        <button
          type="button"
          className="code-block__expand"
          onClick={() => setExpanded(value => !value)}
        >
          {expanded ? "收起代码" : `展开剩余 ${lines.length - 20} 行`}
        </button>
      )}
    </div>
  );
}


/** 从任意 ReactNode 中提取纯文本（能穿透 hljs 的 span 元素） */
function getTextFromChildren(children: React.ReactNode): string {
  if (children == null || typeof children === 'boolean') return '';
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(getTextFromChildren).join('');
  if (React.isValidElement(children)) {
    return getTextFromChildren(
      (children.props as { children?: React.ReactNode }).children
    );
  }
  return '';
}

/* ---------- 行内代码 ---------- */
type CodeProps = React.ComponentPropsWithoutRef<'code'> & ExtraProps;

const InlineCode: NonNullable<Components['code']> = ({
  node,
  className,
  children,
  ...props
}: CodeProps) => (
  <code
    className={className}
    style={{
      fontFamily: '"JetBrains Mono","Fira Code","Cascadia Code","SF Mono",Menlo,Monaco,Consolas,"Courier New",monospace',
      fontSize: '0.88em',
      background: '#f2f3f5',
      color: '#4c4247',
      padding: '0.15em 0.4em',
      borderRadius: 4,
      border: '1px solid #e8e8ec',
    }}
    {...props}
  >
    {children}
  </code>
);

/* ---------- 代码块：接管 pre ---------- */
type PreProps = React.ComponentPropsWithoutRef<'pre'> & ExtraProps;

const Pre: NonNullable<Components['pre']> = ({ node, children, ...props }: PreProps) => {
  // Pre 的 children 就是 <InlineCode>（或原生 <code>）元素
  const codeEl = React.Children.toArray(children).find(
    (c): c is React.ReactElement<{ className?: string; children?: React.ReactNode }> =>
      React.isValidElement(c) && (c.type === InlineCode || c.type === 'code')
  );

  const className = codeEl?.props?.className ?? '';
  const language = /language-([\w-]+)/.exec(className)?.[1] ?? 'text';
  const code = getTextFromChildren(codeEl?.props?.children).replace(/\n$/, '');

  return <CodeBlock language={language} code={code} />;
};

/* ---------- 标题 id：基于文本，避免每次渲染重置 ---------- */
const slugify = (text: string) =>
  text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fa5-]/g, '') || 'heading';

const makeHeading =
  (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'): NonNullable<Components[typeof Tag]> =>
  ({ children }) => {
    const id = slugify(getTextFromChildren(children));
    return (
      <Tag id={id} className="heading">
        {children}
      </Tag>
    );
  };


/* 1. 安全协议白名单 */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

function isSafeUrl(href: string): boolean {
  try {
    // 用当前 origin 兜底解析相对路径，避免 new URL 抛错
    const url = new URL(href, window.location.origin);
    return SAFE_PROTOCOLS.has(url.protocol.toLowerCase());
  } catch {
    return false;
  }
}

/* 2. 类型用 Components['a']，避免 exactOptionalPropertyTypes 报错 */
type AnchorProps = React.ComponentPropsWithoutRef<'a'> & ExtraProps;

const Anchor: NonNullable<Components['a']> = ({
  href,
  children,
  node,
  ...props
}: AnchorProps) => {
  // href 可能为 undefined（markdown 语法异常时）
  if (!href || !isSafeUrl(href)) {
    return <span>{children}</span>;
  }

  return (
    <a
      href={href}
      className="text-blue-600 hover:underline"
      {...props}                       // 先展开外部属性
      target="_blank"                  // 再强制安全属性
      rel="noopener noreferrer nofollow"
    >
      {children}
    </a>
  );
};


type ImgProps = React.ComponentPropsWithoutRef<'img'> & ExtraProps;

const Img: NonNullable<Components['img']> = ({src, alt, ...props}: ImgProps) => {
    const allowedDomains = ['trusted-cdn.com', 'secure-images.example.com']
    if (!src) return null;
    const url = new URL(src)
    
    if (!allowedDomains.includes(url.hostname)) {
      return <div className="image-blocked">图片已被阻止显示</div>
    }
    
    return <img src={src} alt={alt} {...props} />
};


const StreamingMarkdown = ({ content }:{content: string}) => {
    // let index = 0;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        //  a: ({ href, children, ...props }:{href: string; children: React.ReactNode;}) => {
        //     if (!href || !isSafeUrl(href)) {
        //         return <span>{children}</span>;
        //     }
        //     return (<a 
        //         href={href} 
        //         className="text-blue-600 hover:underline"
        //         target="_blank"
        //         rel="noopener noreferrer"
        //         {...props}
        //     >
        //         {children}
        //     </a>)
        //  },
        a: Anchor,
        pre: Pre,
        code: InlineCode,
        img: Img,
        // code({ node, className, children, ...props }) {
        //     console.log(className, children)
        // //   const match = /language-(\w+)/.exec(className || '');
        //   const language = className?.replace('language-', '') || 'text';
        //    return (<pre className={`language-${language}`} style={{
        //         background: '#f8f8f8',
        //         padding: '12px',
        //         borderRadius: '6px',
        //         overflowX: 'auto',
        //         // margin: '12px 0',
        //         fontStyle: 'initial',
        //         minWidth: '100%',
        //         width: 'max-content',
        //         fontFamily: '"JetBrains Mono","Fira Code","Cascadia Code","SF Mono",Menlo,Monaco,Consolas,"Courier New",monospace',
        //         fontSize: '0.88em',
        //       }}>
        //        <CodeBlock language={language} code={code} /> 
        //         {/* <code style={{ fontFamily: 'inherit' }} {...props}>{children}</code> */}
        //     </pre>)
        // //   return match ? (
        // //     <CodeBlock
        // //       language={match[1]}
        // //       codeString={String(children)}
        // //     />
        // //   ) : (
        // //     <code className="p-1 bg-gray-100 dark:bg-gray-800" children={children} />
        // //   )
        // //   return match ? (
        // //     <pre
        // //       className={className}
        // //       {...props}
        // //       style={{
        // //         background: '#f8f8f8',
        // //         padding: '12px',
        // //         borderRadius: '6px',
        // //         overflowX: 'auto',
        // //         margin: '12px 0',
        // //       }}
        // //     >
        // //       <code>{children}</code>
        // //     </pre>
        // //   ) : (
        // //     <code
        // //       className={className}
        // //       {...props}
        // //       style={{
        // //         background: '#f0f0f0',
        // //         padding: '2px 4px',
        // //         borderRadius: '3px',
        // //         fontSize: '0.9em',
        // //       }}
        // //     >
        // //       {children}
        // //     </code>
        // //   );
        // },
        // 表格容器支持横向滚动
        table({ children }) {
          return (
            <div style={{ overflowX: 'auto', margin: '12px 0' }}>
              <table
                style={{
                  borderCollapse: 'collapse',
                  minWidth: '100%',
                  width: 'max-content',
                  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                }}
                // style={{
                //     fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                //     lineHeight: 1.6,
                //     background: '#f6f8fa',
                //     padding: '16px',
                //     borderRadius: '8px',
                //     overflowX: 'auto',
                //     margin: '12px 0',
                //     }}
              >
                {children}
              </table>
            </div>
          );
        },
        th({ children }) {
          return (
            <th
              style={{
                border: '1px solid #ddd',
                padding: '8px 12px',
                backgroundColor: '#f5f5f5',
                fontWeight: '600',
              }}
            >
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td
              style={{
                border: '1px solid #ddd',
                padding: '8px 12px',
                verticalAlign: 'top',
              }}
            >
              {children}
            </td>
          );
        },
        // 防止公式过宽
        div: ({ children, ...props }) => <div {...props}>{children}</div>,
        h1: makeHeading('h1'),
        h2: makeHeading('h2'),
        h3: makeHeading('h3'),
        h4: makeHeading('h4'),
        h5: makeHeading('h5'),
        h6: makeHeading('h6'),
        // h1({ children }) {
        //   return (
        //     <h1 id={"heading-" + ++index} className="heading">
        //       {children}
        //     </h1>
        //   );
        // },
        // h2({ children }) {
        //   return (
        //     <h2 id={"heading-" + ++index} className="heading">
        //       {children}
        //     </h2>
        //   );
        // },
        // h3({ children }) {
        //   return (
        //     <h3 id={"heading-" + ++index} className="heading">
        //       {children}
        //     </h3>
        //   );
        // },
        // h4({ children }) {
        //   return (
        //     <h4 id={"heading-" + ++index} className="heading">
        //       {children}
        //     </h4>
        //   );
        // },
        // h5({ children }) {
        //   return (
        //     <h5 id={"heading-" + ++index} className="heading">
        //       {children}
        //     </h5>
        //   );
        // },
        // h6({ children }) {
        //   return (
        //     <h6 id={"heading-" + ++index} className="heading">
        //       {children}
        //     </h6>
        //   );
        // }
      }} 
    >
      {content}
    </ReactMarkdown>
  );
};

export default StreamingMarkdown;
