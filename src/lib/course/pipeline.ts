export type PipelineStage =
  | 'upload'
  | 'extract'
  | 'figures'
  | 'chunk'
  | 'index'
  | 'ready'
  | 'error'

export const pipelineLabels: Record<PipelineStage, string> = {
  upload: 'Receiving the file',
  extract: 'Extracting text (OCR where needed)',
  figures: 'Pulling figures and equations',
  chunk: 'Chunking against the course outline',
  index: 'Indexing into the course knowledge base',
  ready: 'Ready for the tutor',
  error: 'Could not process this file',
}

export const pipelineOrder: PipelineStage[] = [
  'upload',
  'extract',
  'figures',
  'chunk',
  'index',
  'ready',
]

/**
 * Document pipeline — UI-visible stages only.
 * Real OCR / embeddings plug in behind these names later.
 */
export function nextStage(stage: PipelineStage): PipelineStage {
  const i = pipelineOrder.indexOf(stage)
  if (i < 0 || i >= pipelineOrder.length - 1) return 'ready'
  return pipelineOrder[i + 1] ?? 'ready'
}

