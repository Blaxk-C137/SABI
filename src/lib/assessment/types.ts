export interface Evaluation {
  correctness: number
  conceptual_understanding: number
  reasoning: number
  recall: number
  explanation: number
  application: number
  confidence: number
  misconceptions: string[]
  needs_followup: boolean
  gotRight: string[]
  missing: string[]
  whyItMatters: string
  tryThis: string
  summary: string
}

export interface Question {
  id: string
  courseId: string
  topicId: string
  prompt: string
  kind: 'explain' | 'apply' | 'derive' | 'discuss' | 'followup'
  expected: string[]
  traps: { match: string; misconception: string }[]
}

