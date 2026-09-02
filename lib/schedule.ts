export type CourseOverride = {
  id: string
  week: number
  cancelled?: boolean
  day?: number
  startSection?: number
  endSection?: number
  room?: string
  teachers?: string[]
}

export type Course = {
  id: string
  code?: string
  name: string
  teachers: string[]
  room: string
  day: number
  startSection: number
  endSection: number
  weeks: number[]
  color: number
  custom?: boolean
  note?: string
  overrides?: CourseOverride[]
  adjusted?: boolean
  cancelled?: boolean
}

export type Schedule = {
  term: string
  startsOn: string
  importedAt: string
  source: "sample" | "pdf"
  courses: Course[]
}

const weeks = (end: number) => Array.from({ length: end }, (_, index) => index + 1)

export const initialSchedule: Schedule = {
  term: "2026-2027学年第一学期",
  startsOn: "2026-08-31",
  importedAt: "2026-09-02T00:00:00.000Z",
  source: "sample",
  courses: [
    { id: "demo-01", code: "DEMO-001", name: "数据结构", teachers: ["张老师"], room: "教学楼 A101", day: 1, startSection: 1, endSection: 2, weeks: weeks(16), color: 0 },
    { id: "demo-02", code: "DEMO-002", name: "大学英语", teachers: ["李老师"], room: "教学楼 B205", day: 1, startSection: 5, endSection: 6, weeks: weeks(16), color: 1 },
    { id: "demo-03", code: "DEMO-003", name: "程序设计基础", teachers: ["王老师"], room: "实验楼 机房301", day: 1, startSection: 9, endSection: 10, weeks: [2, 4, 6, 8, 10, 12, 14, 16], color: 2 },
    { id: "demo-04", code: "DEMO-004", name: "高等数学", teachers: ["陈老师"], room: "综合楼 综203", day: 2, startSection: 3, endSection: 4, weeks: weeks(16), color: 3 },
    { id: "demo-05", code: "DEMO-005", name: "计算机网络", teachers: ["周老师"], room: "教学楼 C108", day: 2, startSection: 7, endSection: 8, weeks: weeks(12), color: 4 },
    { id: "demo-06", code: "DEMO-006", name: "体育", teachers: ["赵老师"], room: "体育馆 2号场", day: 3, startSection: 1, endSection: 2, weeks: weeks(16), color: 5 },
    { id: "demo-07", code: "DEMO-007", name: "操作系统", teachers: ["孙老师"], room: "综合楼 综305", day: 3, startSection: 5, endSection: 6, weeks: weeks(14), color: 6 },
    { id: "demo-08", code: "DEMO-008", name: "数据库原理", teachers: ["吴老师"], room: "教学楼 B103", day: 3, startSection: 11, endSection: 12, weeks: [1, 3, 5, 7, 9, 11, 13, 15], color: 7 },
    { id: "demo-09", code: "DEMO-009", name: "离散数学", teachers: ["郑老师"], room: "教学楼 A206", day: 4, startSection: 1, endSection: 2, weeks: weeks(16), color: 0 },
    { id: "demo-10", code: "DEMO-010", name: "软件工程", teachers: ["何老师"], room: "综合楼 综402", day: 4, startSection: 7, endSection: 8, weeks: weeks(12), color: 1 },
    { id: "demo-11", code: "DEMO-011", name: "计算机组成原理", teachers: ["林老师"], room: "教学楼 C210", day: 5, startSection: 3, endSection: 4, weeks: weeks(16), color: 2 },
    { id: "demo-12", code: "DEMO-012", name: "人工智能导论", teachers: ["许老师"], room: "实验楼 机房205", day: 5, startSection: 5, endSection: 6, weeks: weeks(10), color: 3 },
    { id: "demo-13", code: "DEMO-013", name: "创新实践", teachers: ["胡老师"], room: "创新中心 104", day: 6, startSection: 5, endSection: 6, weeks: [3, 6, 9, 12, 15], color: 4 },
  ],
}

export const dayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

export const timeSlots = [
  { start: 1, end: 2, phase: "上午", time: "08:00–09:35" },
  { start: 3, end: 4, phase: "上午", time: "10:05–11:40" },
  { start: 5, end: 6, phase: "下午", time: "13:30–15:05" },
  { start: 7, end: 8, phase: "下午", time: "15:35–17:10" },
  { start: 9, end: 10, phase: "晚上", time: "18:00–19:35" },
  { start: 11, end: 12, phase: "晚上", time: "20:05–21:40" },
]

export function currentWeek(startsOn: string, now = new Date()) {
  const [year, month, day] = startsOn.split("-").map(Number)
  const start = new Date(year, month - 1, day)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(1, Math.floor((today.getTime() - start.getTime()) / 604800000) + 1)
}

export function dateForWeekday(startsOn: string, week: number, weekday: number) {
  const [year, month, day] = startsOn.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + (week - 1) * 7 + weekday - 1)
  return date
}

export function weekRange(startsOn: string, week: number) {
  const start = dateForWeekday(startsOn, week, 1)
  const end = dateForWeekday(startsOn, week, 7)
  const startText = `${start.getMonth() + 1}月${start.getDate()}日`
  const endText = `${end.getMonth() + 1}月${end.getDate()}日`
  return `${startText}—${endText}`
}

export function compactWeeks(values: number[]) {
  if (!values.length) return "周次待定"
  const sorted = [...new Set(values)].sort((a, b) => a - b)
  const alternating = sorted.length > 2 && sorted.every((value, i) => i === 0 || value - sorted[i - 1] === 2)
  if (alternating) return `${sorted[0]}–${sorted.at(-1)}周（${sorted[0] % 2 ? "单" : "双"}周）`
  const ranges: string[] = []
  let start = sorted[0]
  let end = sorted[0]
  for (const value of sorted.slice(1)) {
    if (value === end + 1) end = value
    else {
      ranges.push(start === end ? `${start}` : `${start}–${end}`)
      start = end = value
    }
  }
  ranges.push(start === end ? `${start}` : `${start}–${end}`)
  return `${ranges.join("、")}周`
}
