import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function AgentMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, ...props }) => (
          <a {...props} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
