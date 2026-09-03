import { unzipSync } from "fflate"

import { parseDlutSchedulePdf } from "./dlut-pdf-parser"
import { timeSlots, type Course, type Schedule } from "./schedule"

type TableRow = string[]

const decoder = new TextDecoder("utf-8")
const clean = (value: unknown) => String(value ?? "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim()
const compact = (value: unknown) => clean(value).replace(/[\s_\-—–（）()【】\[\]:：]/g, "").toLowerCase()

const aliases = {
  name: ["课程名称", "课程名", "课程", "名称", "course", "coursename", "subject", "summary"],
  code: ["课程代码", "课程编号", "课号", "code", "coursecode"],
  teacher: ["任课教师", "授课教师", "教师", "老师", "teacher", "instructor"],
  room: ["上课地点", "上课教室", "教室", "地点", "room", "location"],
  day: ["星期", "周几", "星期几", "day", "weekday"],
  sections: ["节次", "上课节次", "课节", "section", "sections"],
  startSection: ["开始节次", "起始节次", "startsection"],
  endSection: ["结束节次", "终止节次", "endsection"],
  weeks: ["周次", "上课周次", "教学周", "weeks", "week"],
  date: ["日期", "上课日期", "date", "startdate", "开始日期"],
  time: ["时间", "上课时间", "time"],
  term: ["学期", "学年学期", "term", "semester"],
  startsOn: ["学期开始日期", "开学日期", "第一周日期", "semesterstart", "startson"],
} as const

type Field = keyof typeof aliases

function fieldFor(value: string): Field | null {
  const key = compact(value)
  for (const [field, names] of Object.entries(aliases) as [Field, readonly string[]][]) {
    if (names.some((name) => compact(name) === key)) return field
  }
  return null
}

function parseDate(value: unknown): Date | null {
  const text = clean(value)
  const match = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?/)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function mondayOf(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return monday
}

function inferredTerm(startsOn: Date) {
  const year = startsOn.getFullYear()
  if (startsOn.getMonth() + 1 >= 7) return `${year}-${year + 1}学年第一学期`
  return `${year - 1}-${year}学年第二学期`
}

function parseDay(value: unknown) {
  const text = clean(value)
  const chinese = text.match(/(?:周|星期)([一二三四五六日天])/)
  if (chinese) return "一二三四五六日天".indexOf(chinese[1]) + 1 > 7 ? 7 : "一二三四五六日天".indexOf(chinese[1]) + 1
  const number = Number(text.match(/[1-7]/)?.[0])
  return number >= 1 && number <= 7 ? number : null
}

export function parseWeekExpression(value: unknown) {
  const text = clean(value).replace(/至|～|—|–/g, "-")
  const parity = text.includes("双") ? 0 : text.includes("单") ? 1 : null
  const weeks: number[] = []
  for (const match of text.matchAll(/(\d{1,2})(?:\s*[-~]\s*(\d{1,2}))?/g)) {
    const start = Number(match[1])
    const end = Math.min(30, Number(match[2] ?? match[1]))
    for (let week = start; week <= end; week += 1) {
      if (parity === null || week % 2 === parity) weeks.push(week)
    }
  }
  return [...new Set(weeks.filter((week) => week >= 1 && week <= 30))].sort((a, b) => a - b)
}

function sectionFromTime(value: string) {
  const match = value.match(/(\d{1,2}):(\d{2})/)
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  const starts = timeSlots.map((slot) => {
    const [hour, minute] = slot.time.split("–")[0].split(":").map(Number)
    return { section: slot.start, distance: Math.abs(minutes - (hour * 60 + minute)) }
  }).sort((a, b) => a.distance - b.distance)
  return starts[0].distance <= 45 ? starts[0].section : null
}

function parseSections(sectionValue: unknown, startValue: unknown, endValue: unknown, timeValue: unknown) {
  const explicitStart = Number(clean(startValue).match(/\d{1,2}/)?.[0])
  const explicitEnd = Number(clean(endValue).match(/\d{1,2}/)?.[0])
  if (explicitStart >= 1 && explicitStart <= 12) {
    return [explicitStart, explicitEnd >= explicitStart && explicitEnd <= 12 ? explicitEnd : explicitStart] as const
  }
  const values = [...clean(sectionValue).matchAll(/\d{1,2}/g)].map((match) => Number(match[0])).filter((number) => number >= 1 && number <= 12)
  if (values.length) return [Math.min(...values), Math.max(...values)] as const
  const timeStart = sectionFromTime(clean(timeValue))
  if (timeStart) {
    const slot = timeSlots.find((item) => item.start === timeStart)
    return [timeStart, slot?.end ?? timeStart] as const
  }
  return null
}

function colorFor(value: string) {
  return [...value].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 8
}

function splitTeachers(value: unknown) {
  return [...new Set(clean(value).replace(/(?:任课教师|授课教师|教师|老师)[:：]?/g, "").split(/[、，,;；/]/).map(clean).filter(Boolean))]
}

function scheduleFromTable(rows: TableRow[], sourceName: string): Schedule {
  const headerIndex = rows.findIndex((row) => {
    const fields = row.map(fieldFor).filter(Boolean)
    return fields.includes("name") && (fields.includes("day") || fields.includes("date"))
      && (fields.includes("sections") || fields.includes("startSection") || fields.includes("time"))
  })
  if (headerIndex < 0) throw new Error(`${sourceName} 中没有找到课程名称、星期和节次等表头`)

  const columns = new Map<Field, number>()
  rows[headerIndex].forEach((value, index) => {
    const field = fieldFor(value)
    if (field && !columns.has(field)) columns.set(field, index)
  })
  const valueAt = (row: TableRow, field: Field) => clean(row[columns.get(field) ?? -1])
  const allText = rows.flat().map(clean).filter(Boolean).join("\n")
  const explicitStartText = allText.match(/(?:学期开始日期|开学日期|第一周日期|semester\s*start)[^\d]{0,30}(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2})/i)?.[1]
    ?? rows.slice(headerIndex + 1).map((row) => valueAt(row, "startsOn")).find(Boolean)
  let startDate = parseDate(explicitStartText)
  const rowDates = rows.slice(headerIndex + 1).map((row) => parseDate(valueAt(row, "date"))).filter((date): date is Date => Boolean(date))
  if (!startDate && rowDates.length) startDate = mondayOf(rowDates.sort((a, b) => a.getTime() - b.getTime())[0])
  if (!startDate) throw new Error(`${sourceName} 中没有学期开始日期；请增加“学期开始日期”列或使用带日期的课程文件`)

  const startsOn = isoDate(mondayOf(startDate))
  const term = allText.match(/\d{4}\s*-\s*\d{4}\s*学年\s*第[一二12]\s*学期/)?.[0]
    ?.replace(/\s+/g, "").replace("第1学期", "第一学期").replace("第2学期", "第二学期")
    ?? inferredTerm(startDate)
  const courses: Course[] = []

  for (const row of rows.slice(headerIndex + 1)) {
    const name = valueAt(row, "name")
    if (!name) continue
    const date = parseDate(valueAt(row, "date"))
    const day = parseDay(valueAt(row, "day")) ?? (date ? (date.getDay() || 7) : null)
    const sections = parseSections(valueAt(row, "sections"), valueAt(row, "startSection"), valueAt(row, "endSection"), valueAt(row, "time"))
    if (!day || !sections) continue
    let weeks = parseWeekExpression(valueAt(row, "weeks"))
    if (!weeks.length && date) weeks = [Math.floor((mondayOf(date).getTime() - mondayOf(startDate).getTime()) / 604800000) + 1]
    if (!weeks.length) continue
    const code = valueAt(row, "code") || undefined
    const room = valueAt(row, "room") || "教室待定"
    const key = `${code ?? name}-${day}-${sections[0]}-${sections[1]}-${room}`
    const existing = courses.find((course) => course.id === key)
    if (existing) {
      existing.weeks = [...new Set([...existing.weeks, ...weeks])].sort((a, b) => a - b)
      continue
    }
    courses.push({
      id: key,
      code,
      name,
      teachers: splitTeachers(valueAt(row, "teacher")),
      room,
      day,
      startSection: sections[0],
      endSection: sections[1],
      weeks,
      color: colorFor(code ?? name),
    })
  }
  if (!courses.length) throw new Error(`${sourceName} 中没有识别到有效课程，请检查星期、节次和周次`)
  return { term, startsOn, importedAt: new Date().toISOString(), source: "file" as Schedule["source"], courses }
}

function parseDelimited(text: string, delimiter?: string): TableRow[] {
  const separator = delimiter ?? (["\t", ",", ";"].sort((a, b) => (text.split(b).length - text.split(a).length))[0])
  const rows: TableRow[] = [[]]
  let value = ""
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1 }
      else quoted = !quoted
    } else if (character === separator && !quoted) {
      rows.at(-1)?.push(value); value = ""
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1
      rows.at(-1)?.push(value); value = ""
      if (rows.at(-1)?.some((cell) => clean(cell))) rows.push([])
      else rows[rows.length - 1] = []
    } else value += character
  }
  rows.at(-1)?.push(value)
  return rows.filter((row) => row.some((cell) => clean(cell)))
}

function xmlRows(xml: string, sharedStrings: string[]) {
  const doc = new DOMParser().parseFromString(xml, "application/xml")
  return [...doc.querySelectorAll("sheetData row")].map((row) => {
    const values: string[] = []
    for (const cell of row.querySelectorAll("c")) {
      const reference = cell.getAttribute("r") ?? "A1"
      const letters = reference.match(/[A-Z]+/)?.[0] ?? "A"
      let column = 0
      for (const letter of letters) column = column * 26 + letter.charCodeAt(0) - 64
      const type = cell.getAttribute("t")
      const raw = cell.querySelector("v")?.textContent ?? cell.querySelector("is t")?.textContent ?? ""
      values[column - 1] = type === "s" ? sharedStrings[Number(raw)] ?? "" : raw
    }
    return values
  })
}

async function parseXlsx(file: File) {
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const text = (path: string) => archive[path] ? decoder.decode(archive[path]) : ""
  const sharedXml = text("xl/sharedStrings.xml")
  const sharedStrings = sharedXml
    ? [...new DOMParser().parseFromString(sharedXml, "application/xml").querySelectorAll("si")].map((node) => [...node.querySelectorAll("t")].map((part) => part.textContent ?? "").join(""))
    : []
  const sheetPaths = Object.keys(archive).filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path)).sort()
  let lastError: unknown = null
  for (const path of sheetPaths) {
    try { return scheduleFromTable(xmlRows(text(path), sharedStrings), "Excel 文件") }
    catch (error) { lastError = error }
  }
  throw lastError instanceof Error ? lastError : new Error("Excel 文件中没有可读取的工作表")
}

function parseHtmlTable(text: string) {
  const doc = new DOMParser().parseFromString(text, "text/html")
  const rows = [...doc.querySelectorAll("table tr")].map((row) => [...row.querySelectorAll("th,td")].map((cell) => clean(cell.textContent)))
  return scheduleFromTable(rows, "HTML 课表")
}

function parseIcsDate(value: string) {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/)
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0)) : null
}

function parseIcs(text: string): Schedule {
  const unfolded = text.replace(/\r?\n[ \t]/g, "")
  const blocks = [...unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/g)].map((match) => match[1])
  const events = blocks.map((block) => {
    const fields = new Map<string, string>()
    for (const line of block.split(/\r?\n/)) {
      const colon = line.indexOf(":")
      if (colon < 0) continue
      fields.set(line.slice(0, colon).split(";")[0].toUpperCase(), line.slice(colon + 1).replace(/\\n/g, "\n").replace(/\\,/g, ","))
    }
    return { fields, start: parseIcsDate(fields.get("DTSTART") ?? ""), end: parseIcsDate(fields.get("DTEND") ?? "") }
  }).filter((event): event is { fields: Map<string, string>; start: Date; end: Date | null } => Boolean(event.start))
  if (!events.length) throw new Error("ICS 文件中没有课程日程")
  const startsOnDate = mondayOf(events.map((event) => event.start).sort((a, b) => a.getTime() - b.getTime())[0])
  const courses: Course[] = events.flatMap((event) => {
    const name = clean(event.fields.get("SUMMARY"))
    const section = sectionFromTime(`${event.start.getHours()}:${String(event.start.getMinutes()).padStart(2, "0")}`)
    if (!name || !section) return []
    const slot = timeSlots.find((item) => item.start === section) ?? timeSlots[0]
    const startWeek = Math.floor((mondayOf(event.start).getTime() - startsOnDate.getTime()) / 604800000) + 1
    const rule = event.fields.get("RRULE") ?? ""
    const interval = Number(rule.match(/INTERVAL=(\d+)/)?.[1] ?? 1)
    const count = Number(rule.match(/COUNT=(\d+)/)?.[1] ?? 0)
    const until = parseIcsDate(rule.match(/UNTIL=([^;]+)/)?.[1] ?? "")
    const finalWeek = count ? startWeek + (count - 1) * interval : until ? Math.floor((mondayOf(until).getTime() - startsOnDate.getTime()) / 604800000) + 1 : startWeek
    const weeks: number[] = []
    for (let week = startWeek; week <= Math.min(30, finalWeek); week += Math.max(1, interval)) weeks.push(week)
    const description = event.fields.get("DESCRIPTION") ?? ""
    const teachers = splitTeachers(description.match(/(?:任课教师|授课教师|教师|老师)[:：]\s*([^\n]+)/)?.[1] ?? "")
    const code = clean(event.fields.get("UID")) || undefined
    return [{
      id: `${code ?? name}-${event.start.getDay() || 7}-${section}`,
      code,
      name,
      teachers,
      room: clean(event.fields.get("LOCATION")) || "教室待定",
      day: event.start.getDay() || 7,
      startSection: section,
      endSection: slot.end,
      weeks,
      color: colorFor(code ?? name),
    }]
  })
  if (!courses.length) throw new Error("ICS 日程的上课时间无法对应到学校节次")
  return { term: inferredTerm(startsOnDate), startsOn: isoDate(startsOnDate), importedAt: new Date().toISOString(), source: "file" as Schedule["source"], courses }
}

function parseJson(text: string): Schedule {
  const value = JSON.parse(text) as unknown
  const candidate = value && typeof value === "object" && "schedule" in value ? (value as { schedule: unknown }).schedule : value
  if (!candidate || typeof candidate !== "object") throw new Error("JSON 中没有课表数据")
  const schedule = candidate as Partial<Schedule>
  if (typeof schedule.term !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(schedule.startsOn ?? "") || !Array.isArray(schedule.courses)) {
    throw new Error("JSON 不是有效的天扬课表或兼容课表")
  }
  const courses = schedule.courses.filter((course): course is Course => Boolean(course)
    && typeof course.id === "string" && typeof course.name === "string" && Array.isArray(course.weeks)
    && Number.isInteger(course.day) && Number.isInteger(course.startSection) && Number.isInteger(course.endSection))
    .map((course) => ({
      ...course,
      teachers: Array.isArray(course.teachers) ? course.teachers.filter((teacher) => typeof teacher === "string") : [],
      room: typeof course.room === "string" && course.room ? course.room : "教室待定",
      color: Number.isInteger(course.color) ? course.color : colorFor(course.code ?? course.name),
    }))
  if (!courses.length) throw new Error("JSON 中没有有效课程")
  return { term: schedule.term, startsOn: schedule.startsOn as string, importedAt: new Date().toISOString(), source: "file" as Schedule["source"], courses }
}

export async function parseScheduleFile(file: File): Promise<Schedule> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? ""
  if (extension === "pdf" || file.type === "application/pdf") return parseDlutSchedulePdf(file)
  if (extension === "xlsx" || file.type.includes("spreadsheetml")) return parseXlsx(file)
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  if (extension === "xls" && bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    throw new Error("暂不支持旧版二进制 XLS，请在 Excel 中另存为 XLSX 或 CSV 后导入")
  }
  const text = await file.text()
  if (extension === "ics" || /BEGIN:VCALENDAR/i.test(text.slice(0, 500))) return parseIcs(text)
  if (extension === "json" || /^[\s\uFEFF]*[\[{]/.test(text)) return parseJson(text.replace(/^\uFEFF/, ""))
  if (extension === "html" || extension === "htm" || /<table[\s>]/i.test(text)) return parseHtmlTable(text)
  if (["csv", "tsv", "txt", "xls"].includes(extension) || /[,\t;]/.test(text.slice(0, 1000))) {
    return scheduleFromTable(parseDelimited(text.replace(/^\uFEFF/, ""), extension === "tsv" ? "\t" : undefined), extension === "xls" ? "Excel 文本文件" : "表格文件")
  }
  throw new Error("暂不支持这种文件；请选择 PDF、XLSX、CSV、TSV、ICS、HTML 或 JSON")
}
