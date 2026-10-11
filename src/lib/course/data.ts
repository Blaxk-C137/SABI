import type { Course, Student, TutorProfile } from './types'

export const student: Student = {
  id: 'stu-adaeze',
  name: 'Adaeze Nwosu',
  given: 'Adaeze',
  programme: 'Mechanical Engineering',
  level: '200 level',
  campus: 'Abuja',
}

export const tutors: TutorProfile[] = [
  {
    id: 'amina',
    name: 'Amina',
    language: 'en-NG',
    accent: 'Nigerian English',
    style: 'calm lecturer',
    speed: 0.95,
    pitch: 'medium',
    energy: 'confident',
    courseHint: 'Thermodynamics and physics',
  },
  {
    id: 'tunde',
    name: 'Tunde',
    language: 'en-NG',
    accent: 'Nigerian English',
    style: 'energetic',
    speed: 1.04,
    pitch: 'medium',
    energy: 'bright',
    courseHint: 'Mathematics',
  },
  {
    id: 'nkechi',
    name: 'Nkechi',
    language: 'en-NG',
    accent: 'Nigerian English',
    style: 'formal',
    speed: 0.92,
    pitch: 'low',
    energy: 'steady',
    courseHint: 'Engineering analysis',
  },
  {
    id: 'ibrahim',
    name: 'Ibrahim',
    language: 'en-NG',
    accent: 'Nigerian English',
    style: 'friendly coach',
    speed: 1,
    pitch: 'medium',
    energy: 'warm',
    courseHint: 'Study planning',
  },
]

const thermoMastery = {
  first: {
    recall: 0.92,
    explanation: 0.78,
    application: 0.64,
    reasoning: 0.71,
    consistency: 0.8,
  },
  closed: {
    recall: 0.81,
    explanation: 0.68,
    application: 0.55,
    reasoning: 0.6,
    consistency: 0.66,
  },
  open: {
    recall: 0.7,
    explanation: 0.48,
    application: 0.42,
    reasoning: 0.44,
    consistency: 0.5,
  },
  entropy: {
    recall: 0.58,
    explanation: 0.36,
    application: 0.3,
    reasoning: 0.33,
    consistency: 0.4,
  },
  enthalpy: {
    recall: 0.62,
    explanation: 0.44,
    application: 0.38,
    reasoning: 0.4,
    consistency: 0.45,
  },
}

export const courses: Course[] = [
  {
    id: 'get206',
    code: 'GET206',
    title: 'Engineering Thermodynamics',
    level: '200',
    lecturer: 'Dr. A. Okafor',
    notation: 'ΔU = Q − W',
    tutorId: 'amina',
    blurb:
      'First and second laws, closed and open systems, properties of pure substances. Taught from your uploaded lecture notes, in Dr. Okafor’s notation.',
    recommendation: 'Review entropy, then practise open-system energy balances.',
    topics: [
      {
        id: 'first-law',
        title: 'First Law',
        status: 'strong',
        overall: 0.89,
        mastery: thermoMastery.first,
        lastStudied: 'Yesterday',
      },
      {
        id: 'closed-systems',
        title: 'Closed Systems',
        status: 'improving',
        overall: 0.71,
        mastery: thermoMastery.closed,
        lastStudied: 'Yesterday',
        misconception: 'Treats closed systems as isolated.',
      },
      {
        id: 'open-systems',
        title: 'Open Systems',
        status: 'weak',
        overall: 0.54,
        mastery: thermoMastery.open,
        lastStudied: '5 days ago',
      },
      {
        id: 'entropy',
        title: 'Entropy',
        status: 'weak',
        overall: 0.41,
        mastery: thermoMastery.entropy,
        lastStudied: '2 weeks ago',
        misconception: 'Treats entropy as a kind of energy.',
      },
      {
        id: 'enthalpy',
        title: 'Enthalpy',
        status: 'improving',
        overall: 0.49,
        mastery: thermoMastery.enthalpy,
        lastStudied: '8 days ago',
      },
    ],
    materials: [
      {
        id: 'm1',
        title: 'GET206 Lecture 3 — First Law',
        kind: 'pdf',
        pages: 18,
        addedAt: '28 Sep 2026',
        status: 'ready',
        note: 'Notation locked to ΔU = Q − W',
      },
      {
        id: 'm2',
        title: 'Tutorial set — closed systems',
        kind: 'pdf',
        pages: 6,
        addedAt: '1 Oct 2026',
        status: 'ready',
      },
      {
        id: 'm3',
        title: 'Board photo — isolated vs closed',
        kind: 'image',
        addedAt: '2 Oct 2026',
        status: 'ready',
        note: 'Handwritten. OCR extracted.',
      },
      {
        id: 'm4',
        title: 'Course outline 2025/26',
        kind: 'outline',
        pages: 3,
        addedAt: '12 Sep 2026',
        status: 'ready',
      },
    ],
    sessions: [
      {
        id: 's1',
        courseId: 'get206',
        title: 'Closed systems — energy balance',
        at: 'Yesterday, 21:14',
        minutes: 34,
        outcome: 'Follow-up queued on isolated vs closed',
      },
      {
        id: 's2',
        courseId: 'get206',
        title: 'First law in your own words',
        at: 'Thu, 19:02',
        minutes: 22,
        outcome: 'Recall strong, application incomplete',
      },
    ],
  },
  {
    id: 'mth202',
    code: 'MTH202',
    title: 'Engineering Mathematics II',
    level: '200',
    lecturer: 'Prof. Bello',
    notation: '∇, ∂, ∮',
    tutorId: 'tunde',
    blurb: 'ODEs, Laplace, vector calculus. Practise derivations, not only results.',
    recommendation: 'Revisit Laplace transforms with a spoken derivation.',
    topics: [
      {
        id: 'ode',
        title: 'Second-order ODEs',
        status: 'improving',
        overall: 0.66,
        mastery: {
          recall: 0.74,
          explanation: 0.62,
          application: 0.58,
          reasoning: 0.6,
          consistency: 0.63,
        },
      },
      {
        id: 'laplace',
        title: 'Laplace transforms',
        status: 'weak',
        overall: 0.47,
        mastery: {
          recall: 0.55,
          explanation: 0.4,
          application: 0.38,
          reasoning: 0.42,
          consistency: 0.44,
        },
      },
    ],
    materials: [
      {
        id: 'mm1',
        title: 'MTH202 notes pack',
        kind: 'pdf',
        pages: 42,
        addedAt: '20 Sep 2026',
        status: 'ready',
      },
    ],
    sessions: [
      {
        id: 'ms1',
        courseId: 'mth202',
        title: 'Laplace of derivatives',
        at: 'Mon, 16:40',
        minutes: 18,
        outcome: 'Missed shifting theorem condition',
      },
    ],
  },
  {
    id: 'gec204',
    code: 'GEC204',
    title: 'Strength of Materials',
    level: '200',
    lecturer: 'Engr. Eze',
    notation: 'σ = P / A',
    tutorId: 'nkechi',
    blurb: 'Stress, strain, torsion, bending. Diagrams expected in answers.',
    recommendation: 'Draw the Mohr circle once from memory, then explain it.',
    topics: [
      {
        id: 'stress',
        title: 'Axial stress & strain',
        status: 'strong',
        overall: 0.84,
        mastery: {
          recall: 0.9,
          explanation: 0.82,
          application: 0.8,
          reasoning: 0.78,
          consistency: 0.85,
        },
      },
      {
        id: 'mohr',
        title: 'Mohr’s circle',
        status: 'weak',
        overall: 0.38,
        mastery: {
          recall: 0.5,
          explanation: 0.32,
          application: 0.28,
          reasoning: 0.3,
          consistency: 0.34,
        },
      },
    ],
    materials: [],
    sessions: [],
  },
]

export function courseById(id: string) {
  return courses.find((c) => c.id === id)
}

export function tutorById(id: string) {
  return tutors.find((t) => t.id === id)
}

export function overallMastery(course: Course) {
  if (course.topics.length === 0) return 0
  return course.topics.reduce((s, t) => s + t.overall, 0) / course.topics.length
}

export function weakTopics(course: Course) {
  return [...course.topics].sort((a, b) => a.overall - b.overall)
}

