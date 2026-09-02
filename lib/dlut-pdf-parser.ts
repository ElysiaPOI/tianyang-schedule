import type { Course, Schedule } from "./schedule"

export type PositionedText = { text: string; x: number; top: number; width: number }
type CourseMeta = { id: number; code?: string; name: string; teachers: string[] }

const sectionRows = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 12]]

function groupLines(items: PositionedText[], tolerance = 2.8) {
  const lines: { top: number; items: PositionedText[] }[] = []
  for (const item of [...items].sort((a, b) => a.top - b.top || a.x - b.x)) {
    const line = lines.find((candidate) => Math.abs(candidate.top - item.top) <= tolerance)
    if (line) {
      line.items.push(item)
      line.top = (line.top * (line.items.length - 1) + item.top) / line.items.length
    } else lines.push({ top: item.top, items: [item] })
  }
  return lines.sort((a, b) => a.top - b.top).map((line) => ({
    top: line.top,
    text: line.items.sort((a, b) => a.x - b.x).map((item) => item.text.trim()).join(""),
  }))
}

function parseMetadata(items: PositionedText[]) {
  const lines = groupLines(items.filter((item) => item.x >= 949 && item.top > 120))
  const blocks = new Map<number, string>()
  let activeId: number | null = null
  for (const line of lines) {
    const start = line.text.match(/^(\d{1,2})--/)
    if (start) activeId = Number(start[1])
    if (activeId !== null) blocks.set(activeId, `${blocks.get(activeId) ?? ""}${line.text}`)
  }

  const result = new Map<number, CourseMeta>()
  for (const [id, block] of blocks) {
    const prefix = block.match(/^\d{1,2}--\s*(\d+\.\d+)\s*/)
    const remainder = prefix ? block.slice(prefix[0].length) : ""
    const creditStart = remainder.search(/\d*\(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?\)/)
    const name = creditStart >= 0 ? remainder.slice(0, creditStart) : ""
    const teachers = [...block.matchAll(/([\u3400-\u9fff·]{2,8})\((\d{8,})\)/g)].map((entry) => entry[1])
    result.set(id, { id, code: prefix?.[1], name: name || `课程${id}`, teachers })
  }
  return result
}

function nearestWeek(center: number, headers: { week: number; center: number }[]) {
  const nearest = headers.reduce((best, current) =>
    Math.abs(current.center - center) < Math.abs(best.center - center) ? current : best,
  )
  return Math.abs(nearest.center - center) < 18 ? nearest.week : null
}

export function parseDlutPositionedText(items: PositionedText[], importedAt = new Date().toISOString()): Schedule {
  const allText = groupLines(items).map((line) => line.text).join("\n")
  const term = allText.match(/\d{4}-\d{4}学年第[一二]学期/)?.[0] ?? "当前学期"
  const startMatch = allText.match(/自(\d{4})[-年](\d{2})[-月](\d{2})(?:日)?开始执行/)
  if (!startMatch) throw new Error("没有识别到学期开始日期，请确认文件来自“学生大课表”")
  const startsOn = `${startMatch[1]}-${startMatch[2]}-${startMatch[3]}`

  const metadata = parseMetadata(items)
  const weekHeaders = items
    .filter((item) => /^(0[1-9]|1\d|2[0-6])$/.test(item.text.trim()) && item.top > 85 && item.top < 115)
    .map((item) => ({ week: Number(item.text), center: item.x + item.width / 2 }))
    .sort((a, b) => a.week - b.week)
  if (weekHeaders.length < 20) throw new Error("课表周次结构识别失败")

  const rowItems = items
    .filter((item) => item.x > 45 && item.x < 95 && /^(1~2|3~4|5~6|7~8|9~12)$/.test(item.text.trim()))
    .sort((a, b) => a.top - b.top)
  if (rowItems.length < 35) throw new Error("课表节次结构识别失败")

  const labels = items.filter((item) => item.x > 90 && item.x < 850 && /^(\d{1,2})[\u3400-\u9fff]/.test(item.text.trim()))
  const checks = items.filter((item) => item.text.trim() === "√")
  const rooms = items.filter((item) => item.x >= 850 && item.x < 949 && item.top > 120)
  const courses = new Map<string, Course>()

  for (const label of labels) {
    const labelMatch = label.text.trim().match(/^(\d{1,2})([\u3400-\u9fff].*)$/)
    if (!labelMatch) continue
    const courseNumber = Number(labelMatch[1])
    const rowIndex = rowItems.reduce((bestIndex, row, index) =>
      Math.abs(row.top - label.top) < Math.abs(rowItems[bestIndex].top - label.top) ? index : bestIndex,
    0)
    if (Math.abs(rowItems[rowIndex].top - label.top) > 7) continue
    const day = Math.floor(rowIndex / 5) + 1
    const section = sectionRows[rowIndex % 5]
    const rowChecks = checks.filter((check) => Math.abs(check.top - label.top) < 4)
    let activeWeeks = rowChecks
      .map((check) => nearestWeek(check.x + check.width / 2, weekHeaders))
      .filter((week): week is number => week !== null)
    const labelWeek = nearestWeek(label.x + label.width / 2, weekHeaders)
    if (labelWeek !== null) activeWeeks.push(labelWeek)
    activeWeeks = [...new Set(activeWeeks)].sort((a, b) => a - b)
    if (!activeWeeks.length) continue

    const meta = metadata.get(courseNumber)
    const room = rooms
      .filter((candidate) => Math.abs(candidate.top - label.top) < 5)
      .sort((a, b) => a.x - b.x)
      .map((candidate) => candidate.text.trim().replace(/\*/g, ""))
      .join(" ")
    const key = `${courseNumber}-${day}-${section[0]}-${room}`
    const existing = courses.get(key)
    if (existing) {
      existing.weeks = [...new Set([...existing.weeks, ...activeWeeks])].sort((a, b) => a - b)
      continue
    }
    courses.set(key, {
      id: key,
      code: meta?.code,
      name: meta?.name ?? labelMatch[2],
      teachers: meta?.teachers ?? [],
      room: room || "教室待定",
      day,
      startSection: section[0],
      endSection: section[1],
      weeks: [...new Set(activeWeeks)].sort((a, b) => a - b),
      color: (courseNumber - 1) % 8,
    })
  }

  if (courses.size < 5) throw new Error("识别到的课程过少，请确认 PDF 是教务系统导出的学生大课表")
  return {
    term,
    startsOn,
    importedAt,
    source: "pdf",
    courses: [...courses.values()].sort((a, b) => a.day - b.day || a.startSection - b.startSection),
  }
}

export async function parseDlutSchedulePdf(file: File): Promise<Schedule> {
  const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ])
  GlobalWorkerOptions.workerSrc = workerModule.default
  const document = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  if (document.numPages !== 1) throw new Error("目前只支持学校导出的单页学生大课表")

  const page = await document.getPage(1)
  const content = await page.getTextContent()
  const pageHeight = page.view[3] - page.view[1]
  const items: PositionedText[] = content.items.flatMap((raw) => {
    if (!("str" in raw) || !raw.str.trim()) return []
    const height = Math.max(Math.abs(raw.transform[3]), raw.height || 0)
    return [{ text: raw.str, x: raw.transform[4], top: pageHeight - raw.transform[5] - height, width: raw.width }]
  })
  return parseDlutPositionedText(items)
}
