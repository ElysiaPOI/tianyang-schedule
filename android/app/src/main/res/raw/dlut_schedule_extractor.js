(() => {
  const documents = [document]
  for (const frame of document.querySelectorAll("iframe")) {
    try { if (frame.contentDocument) documents.push(frame.contentDocument) } catch {}
  }

  const clean = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim()
  const compact = (value) => clean(value).replace(/\s+/g, "")
  const nodeText = (node) => clean(node.innerText || node.value || node.textContent || "")
  const coursePattern = /\b\d{10,}(?:\.\d+)?\b/
  const placementPattern = /[（(]([^（）()]*?周)[）)]\s*([1-7])\s*[（(]([\d\s,，、~～\-—至]+)[）)]/

  const parseWeeks = (expression) => {
    const normalized = String(expression || "").replace(/至|～|—/g, "~")
    const parity = normalized.includes("双") ? 0 : normalized.includes("单") ? 1 : null
    const values = []
    for (const match of normalized.matchAll(/(\d{1,2})(?:\s*[~\-]\s*(\d{1,2}))?/g)) {
      const start = Number(match[1])
      const end = Number(match[2] || match[1])
      for (let week = start; week <= end && week <= 30; week += 1) {
        if (parity === null || week % 2 === parity) values.push(week)
      }
    }
    return [...new Set(values)].sort((a, b) => a - b)
  }

  const parseSections = (expression) => [...String(expression || "").matchAll(/\d{1,2}/g)]
    .map((match) => Number(match[0]))
    .filter((section) => section >= 1 && section <= 12)

  const courseNodes = []
  for (const doc of documents) {
    for (const node of doc.querySelectorAll("td,article,section,li,a,div")) {
      const text = nodeText(node)
      const normalizedPlacement = text.replace(/[（(](单|双)(?:周)?[）)]/g, "$1")
      if (!coursePattern.test(text) || !placementPattern.test(normalizedPlacement)) continue
      const childContainsWholeCourse = [...node.children].some((child) => {
        const childText = nodeText(child)
        return coursePattern.test(childText)
          && placementPattern.test(childText.replace(/[（(](单|双)(?:周)?[）)]/g, "$1"))
      })
      if (!childContainsWholeCourse) courseNodes.push(node)
    }
  }

  const parsed = []
  for (const node of courseNodes) {
    const raw = nodeText(node)
    const codeMatch = raw.match(coursePattern)
    const placement = raw.replace(/[（(](单|双)(?:周)?[）)]/g, "$1").match(placementPattern)
    if (!codeMatch || !placement || codeMatch.index === undefined || placement.index === undefined) continue

    const weeks = parseWeeks(placement[1])
    const sections = parseSections(placement[3])
    if (!weeks.length || !sections.length) continue

    const code = codeMatch[0]
    const between = raw.slice(codeMatch.index + code.length, placement.index)
    const lines = between.split(/\n+/).map(clean).filter(Boolean)
    let name = lines[0] || ""
    let room = clean(lines.slice(1).join(" "))

    if (!room) {
      const split = clean(between).match(/^(.+?)(?=(?:综合|教学|建筑|体育|主楼|创新|开发区|材料馆|化工楼|机房|实验室|[A-Za-z]\d{2,4}|综\d{2,4}|建\d{2,4}))([\s\S]+)$/)
      if (split) {
        name = clean(split[1])
        room = clean(split[2])
      }
    }
    room = room.replace(/上课组[:：]?.*$/i, "").trim()
    if (!name || name.length > 60) continue

    parsed.push({
      code,
      name,
      // Teachers are not exposed reliably by this page. Web imports leave the
      // field empty instead of guessing from hover popovers.
      teachers: [],
      room: room || "教室待定",
      day: Number(placement[2]),
      startSection: Math.min(...sections),
      endSection: Math.max(...sections),
      weeks,
    })
  }

  const byPlacement = new Map()
  for (const course of parsed) {
    const key = `${course.code}-${course.day}-${course.startSection}-${course.endSection}-${course.room}`
    const existing = byPlacement.get(key)
    if (existing) {
      existing.weeks = [...new Set([...existing.weeks, ...course.weeks])].sort((a, b) => a - b)
    } else byPlacement.set(key, course)
  }

  const allText = documents.map((doc) => nodeText(doc.body)).join("\n")
  const allMarkup = documents.map((doc) => {
    try { return doc.documentElement.innerHTML } catch { return "" }
  }).join("\n")
  const term = (allText + "\n" + allMarkup).match(/\d{4}\s*-\s*\d{4}\s*学年\s*第[一二12]\s*学期/)?.[0]
    ?.replace(/\s+/g, "")
    ?.replace("第1学期", "第一学期")
    ?.replace("第2学期", "第二学期") || "当前学期"

  const termMatch = term.match(/(\d{4})-(\d{4})学年第([一二])学期/)
  const dateSource = `${allText}\n${allMarkup}`
  const dates = []
  for (const match of dateSource.matchAll(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?/g)) {
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
    const date = new Date(year, month - 1, day)
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) dates.push(date)
  }
  const explicitStart = dateSource.match(/(?:自|开始日期|开学日期|起始日期|startDate|semesterStart)[^\d]{0,30}(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/i)
  let startsOn = explicitStart
    ? `${explicitStart[1]}-${String(explicitStart[2]).padStart(2, "0")}-${String(explicitStart[3]).padStart(2, "0")}`
    : ""

  if (!startsOn && termMatch) {
    const expectedYear = Number(termMatch[termMatch[3] === "一" ? 1 : 2])
    const allowedMonths = termMatch[3] === "一" ? [7, 8, 9, 10] : [1, 2, 3, 4]
    const mondayCandidates = dates
      .filter((date) => date.getFullYear() === expectedYear && allowedMonths.includes(date.getMonth() + 1) && date.getDay() === 1)
      .sort((a, b) => a.getTime() - b.getTime())
    if (mondayCandidates.length) {
      const date = mondayCandidates[0]
      startsOn = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    }
  }

  const courses = [...byPlacement.values()].map((course) => ({
    id: `${course.code}-${course.day}-${course.startSection}-${course.endSection}-${compact(course.room)}`,
    ...course,
    color: [...course.code].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 8,
  })).sort((a, b) => a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name, "zh-CN"))

  if (courses.length >= 3 && /^20\d{2}-\d{2}-\d{2}$/.test(startsOn)) {
    return {
      action: "data",
      schedule: { term, startsOn, importedAt: new Date().toISOString(), source: "web", courses },
    }
  }
  return { action: "none", courseCount: courses.length, hasStartDate: Boolean(startsOn) }
})()
