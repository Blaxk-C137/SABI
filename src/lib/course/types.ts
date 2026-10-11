export type MasteryDimension =
  | 'recall'
  | 'explanation'
  | 'application'
  | 'reasoning'
  | 'consistency'

export type TopicStatus = 'weak' | 'improving' | 'strong' | 'unseen'

export type MaterialKind = 'pdf' | 'slides' | 'notes' | 'image' | 'outline'

export type IntegrityMode = 'teach' | 'practice' | 'assessment' | 'review'

export interface Mastery {
  recall: number
  explanation: number
  application: number
  reasoning: number
  consistency: number
}

export interface Topic {
  id: string
  title: string
  status: TopicStatus
  mastery: Mastery
  overall: number
  lastStudied?: string
  misconception?: string
}

export interface Material {
  id: string
  title: string
  kind: MaterialKind
  pages?: number
  addedAt: string
  status: 'ready' | 'processing' | 'failed'
  note?: string
}

export interface SessionSummary {
  id: string
  courseId: string
  title: string
  at: string
  minutes: number
  outcome: string
}

export interface Course {
  id: string
  code: string
  title: string
  level: string
  lecturer: string
  notation: string
  tutorId: string
  blurb: string
  topics: Topic[]
  materials: Material[]
  sessions: SessionSummary[]
  recommendation: string
}

export interface TutorProfile {
  id: string
  name: string
  language: string
  accent: string
  style: string
  speed: number
  pitch: 'low' | 'medium' | 'high'
  energy: string
  courseHint: string
}

export interface Student {
  id: string
  name: string
  given: string
  programme: string
  level: string
  campus: string
}

