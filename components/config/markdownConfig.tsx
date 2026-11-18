import React from 'react';
import { type Components, type Options, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
// import rehypeSlug from 'rehype-slug';
// import rehypeAutolinkHeadings from 'rehype-autolink-headings';


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

const slugify = (text: string) =>
  text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fa5-]/g, '') || 'heading';


const makeHeading = (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'): NonNullable<Components[typeof Tag]> => ({ children }) => {
    const id = slugify(getTextFromChildren(children));
    return (
      <Tag id={id} className="heading">
        {children}
      </Tag>
    );
  };

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

 
type MarkdownConfig = Pick<
  Options,
  'remarkPlugins' | 'rehypePlugins' | 'components' | 'urlTransform'
>;

const CustomCodeBlock: NonNullable<Components['code']> = ({ node, ...props }) => (
  <code {...props} />
);

const CustomTable: NonNullable<Components['table']> = ({ node, children, ...props }) => (
  <table {...props}>{children}</table>
);

const LazyImage: NonNullable<Components['img']> = ({ node, ...props }) => (
  <img loading="lazy" {...props} />
);

export const markdownConfig: MarkdownConfig = {
  remarkPlugins: [
    remarkGfm,
    remarkMath,
  ],
  rehypePlugins: [
    rehypeKatex,
    rehypeHighlight,
    // rehypeSlug,
    // [rehypeAutolinkHeadings, {
    //   behavior: 'wrap',
    //   properties: {
    //     className: ['heading-anchor'],
    //     ariaHidden: true,
    //     tabIndex: -1
    //   }
    // }]
  ],
  components: {
    h1: makeHeading('h1'),
    h2: makeHeading('h2'),
    h3: makeHeading('h3'),
    h4: makeHeading('h4'),
    h5: makeHeading('h5'),
    h6: makeHeading('h6'),
    code: CustomCodeBlock,
    table: CustomTable,
    img: LazyImage,
    a: Anchor,
  },
  urlTransform: (url: string) => {
    // 企业级URL安全策略
    return isSafeUrl(url) ? url : null;
  }
};
