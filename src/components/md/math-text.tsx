import Markdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { normalizeLatex } from '@/lib/latex'
import { cn } from '@/lib/utils'

export function MathText({
  text,
  className,
  streaming,
}: {
  text: string
  className?: string
  streaming?: boolean
}) {
  const src = normalizeLatex(text || '')
  return (
    <div className={cn('math-body max-w-[62ch]', className)}>
      <Markdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
      >
        {src}
      </Markdown>
      {streaming ? (
        <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 bg-accent animate-pulse" />
      ) : null}
    </div>
  )
}

