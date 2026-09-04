(() => {
  const documents = [document]
  const pageWindows = [window]
  for (const frame of document.querySelectorAll("iframe")) {
    try {
      if (frame.contentDocument) documents.push(frame.contentDocument)
      if (frame.contentWindow) pageWindows.push(frame.contentWindow)
    } catch (_) {}
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

  const attributeText = (node) => {
    const values = []
    const descendants = node.querySelectorAll ? [...node.querySelectorAll("[title],[data-title],[data-content],[data-original-title],[aria-label],[aria-describedby]")] : []
    const ancestors = []
    for (let current = node && node.parentElement, depth = 0; current && depth < 8; current = current.parentElement, depth += 1) ancestors.push(current)
    for (const current of [node, ...descendants, ...ancestors]) {
      for (const name of ["title", "data-title", "data-content", "data-original-title", "aria-label"]) {
        const value = current.getAttribute && current.getAttribute(name)
        if (value) values.push(value)
      }
      if (current.attributes) {
        for (const attribute of current.attributes) {
          if (/teacher|tooltip|popover|content|title/i.test(attribute.name) && attribute.value) values.push(attribute.value)
        }
      }
      const describedBy = current.getAttribute && current.getAttribute("aria-describedby")
      if (describedBy && current.ownerDocument) {
        for (const id of describedBy.split(/\s+/)) {
          const description = current.ownerDocument.getElementById(id)
          if (description) values.push(nodeText(description))
        }
      }
    }
    return clean(values.join("\n"))
  }

  const extractTeachers = (value) => {
    const result = []
    const source = clean(value)
    for (const match of source.matchAll(/(?:任课教师|授课教师|主讲教师|教师姓名|教师|老师)[:： \t]*([\u3400-\u9fff·、，, \t]{2,50})/g)) {
      result.push(...match[1].split(/[、，,\s]+/))
    }
    for (const match of source.matchAll(/(?:teacherNames?|teacherName|instructorNames?|instructor|jsmc|jsxm|rkjs|skjs)["']?\s*[:=]\s*["']([^"'\]\[}{]{2,80})/gi)) {
      result.push(...match[1].split(/[、，,;；/\s]+/))
    }
    // The DLUT popover does not label teachers. Its repeated block is:
    // class names -> teacher name -> campus/room/weeks. Treat only a standalone
    // Chinese name immediately followed by a location line as a teacher.
    const lines = String(value || "").replace(/\u00a0/g, " ").split(/\n+/).map(clean).filter(Boolean)
    const locationLine = /(?:校区|教学|综合|建筑|主楼|创新|开发区|材料馆|化工楼|体育馆|排球馆|体育场|教室|机房|实验室|[A-Za-z]\d{2,4}|综\d{2,4}|建\d{2,4}).*(?:周|楼|馆|场|室|\d)/
    const classLine = /^[\u3400-\u9fff]{1,8}\d{4}(?:[\/／]\d{2,4})*(?:班)?$/
    const structuredTeachers = []
    for (let index = 0; index + 1 < lines.length; index += 1) {
      const candidate = lines[index].replace(/^[·•*\-—]+\s*/, "")
      const previous = lines[index - 1] || ""
      const insideAssignmentBlock = classLine.test(previous) || (structuredTeachers.length > 0 && locationLine.test(previous))
      if (insideAssignmentBlock && /^[\u3400-\u9fff·]{2,8}$/.test(candidate) && locationLine.test(lines[index + 1])) {
        structuredTeachers.push(candidate)
        result.push(candidate)
      }
    }
    return [...new Set(result.map((name) => clean(name).replace(/[（(].*?[）)]/g, "").replace(/老师$/g, ""))
      .filter((name) => /^[\u3400-\u9fff·]{2,8}$/.test(name) && !/^(任课|授课|主讲|教师|老师|姓名|上课|默认组|课程性质|开课单位|凌水主校区|开发区校区)$/.test(name)))]
  }

  const capturedPayloads = pageWindows.flatMap((pageWindow) => {
    try { return Array.isArray(pageWindow.__tianyangScheduleNetworkPayloads) ? pageWindow.__tianyangScheduleNetworkPayloads : [] } catch (_) { return [] }
  })
  const payloadText = (payload) => typeof payload === "string" ? payload : clean(payload && payload.text)
  const payloadUrl = (payload) => typeof payload === "object" && payload ? clean(payload.url) : ""

  const teachersFromPayloads = (course) => {
    const result = []
    const teacherKey = /^(?:teacherNames?|teacherName|instructorNames?|instructor|jsmc|jsxm|rkjs|skjs|jzgxm|rkjsmc)$/i
    const collect = (value) => {
      const values = Array.isArray(value) ? value : [value]
      for (const item of values) {
        if (typeof item === "string") result.push(...extractTeachers(`教师:${item}`))
        else if (item && typeof item === "object") {
          for (const nested of Object.values(item)) if (typeof nested === "string") result.push(...extractTeachers(`教师:${nested}`))
        }
      }
    }
    const visit = (value, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 12) return
      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1)
        return
      }
      const primitives = Object.values(value).filter((item) => typeof item === "string" || typeof item === "number").map(String)
      const sameCourse = primitives.some((item) => item.includes(course.code) || item === course.name || item.includes(course.name))
      if (sameCourse) {
        for (const [key, item] of Object.entries(value)) if (teacherKey.test(key)) collect(item)
      }
      for (const item of Object.values(value)) if (item && typeof item === "object") visit(item, depth + 1)
    }
    for (const payload of capturedPayloads) {
      const text = payloadText(payload)
      try { visit(JSON.parse(text)) } catch (_) {
        const marker = text.indexOf(course.code) >= 0 ? course.code : course.name
        let index = text.indexOf(marker)
        while (index >= 0) {
          result.push(...extractTeachers(text.slice(Math.max(0, index - 1200), index + marker.length + 1200)))
          index = text.indexOf(marker, index + marker.length)
        }
      }
    }
    return [...new Set(result)]
  }

  const networkDiagnostics = (course) => {
    const samples = []
    const safe = (value) => clean(value)
      .replace(/(password|passwd|pwd|token|cookie|authorization)\s*[:=]\s*[^,;\s]+/gi, "$1=[已隐藏]")
      .slice(0, 180)
    const visit = (value, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 10 || samples.length >= 8) return
      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1)
        return
      }
      const scalarEntries = Object.entries(value).filter(([, item]) => typeof item === "string" || typeof item === "number")
      const sameCourse = scalarEntries.some(([, item]) => String(item).includes(course.code)
        || String(item) === course.name || String(item).includes(course.name))
      if (sameCourse) {
        samples.push({
          keys: Object.keys(value).slice(0, 40),
          values: scalarEntries.slice(0, 24).map(([key, item]) => `${key}=${safe(item)}`),
        })
      }
      for (const item of Object.values(value)) if (item && typeof item === "object") visit(item, depth + 1)
    }
    for (const payload of capturedPayloads) {
      const text = payloadText(payload)
      if (!text || (!text.includes(course.code) && !text.includes(course.name))) continue
      try { visit(JSON.parse(text)) } catch (_) {
        samples.push({ url: payloadUrl(payload), rawAroundCourse: safe(text.slice(Math.max(0, text.indexOf(course.code) - 250), text.indexOf(course.code) + 900)) })
      }
    }
    return samples.slice(0, 8)
  }

  const courseNodes = []
  for (const doc of documents) {
    const nodes = [...doc.querySelectorAll("td,article,section,li,a,div")]
    for (const node of nodes) {
      const text = nodeText(node)
      const normalizedPlacement = text.replace(/[（(](单|双)(?:周)?[）)]/g, "$1")
      if (!coursePattern.test(text) || !placementPattern.test(normalizedPlacement)) continue
      const childContainsWholeCourse = [...node.children].some((child) => {
        const childText = nodeText(child)
        return coursePattern.test(childText) && placementPattern.test(childText.replace(/[（(](单|双)(?:周)?[）)]/g, "$1"))
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

    const metadata = `${raw}\n${attributeText(node)}`
    const teachers = extractTeachers(metadata)

    parsed.push({
      node,
      code,
      name,
      teachers: [...new Set(teachers)],
      room: room || "教室待定",
      day: Number(placement[2]),
      startSection: Math.min(...sections),
      endSection: Math.max(...sections),
      weeks,
    })
  }

  const byPlacement = new Map()
  for (const { node, ...course } of parsed) {
    const key = `${course.code}-${course.day}-${course.startSection}-${course.endSection}-${course.room}`
    const existing = byPlacement.get(key)
    if (existing) {
      existing.weeks = [...new Set([...existing.weeks, ...course.weeks])].sort((a, b) => a - b)
      existing.teachers = [...new Set([...existing.teachers, ...course.teachers])]
    } else byPlacement.set(key, course)
  }

  const allText = documents.map((doc) => nodeText(doc.body)).join("\n")
  const allMarkup = documents.map((doc) => {
    try { return doc.documentElement.innerHTML } catch (_) { return "" }
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

  const teacherState = window.__tianyangScheduleTeacherScan || (window.__tianyangScheduleTeacherScan = {
    teachersByCode: {},
    scannedCodes: {},
    pendingCode: "",
    observedTexts: [],
    observedMutations: [],
    pendingAttempts: 0,
    pendingBaseline: [],
    diagnosticsByCode: {},
  })
  if (!Array.isArray(teacherState.observedTexts)) teacherState.observedTexts = []
  if (!Array.isArray(teacherState.observedMutations)) teacherState.observedMutations = []
  if (!teacherState.diagnosticsByCode) teacherState.diagnosticsByCode = {}

  const tooltipSelectors = [
    "[role=tooltip]", ".tooltip", ".tooltip-inner", ".popover", ".popover-content",
    ".el-tooltip__popper", ".ant-tooltip", ".ant-popover", ".ivu-tooltip-popper",
    ".layui-layer-tips", ".qtip", ".webui-popover",
  ].join(",")
  const elementVisible = (node) => {
    try {
      const win = node.ownerDocument.defaultView
      const style = win.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0
    } catch (_) { return false }
  }
  const rootList = []
  const collectRoots = (root) => {
    if (!root || rootList.includes(root)) return
    rootList.push(root)
    try {
      for (const node of [...root.querySelectorAll("*")].slice(0, 3000)) {
        if (node.shadowRoot) collectRoots(node.shadowRoot)
      }
    } catch (_) {}
  }
  for (const doc of documents) collectRoots(doc)

  const describeNode = (node) => {
    try {
      const style = node.ownerDocument.defaultView.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return {
        tag: String(node.tagName || "node").toLowerCase(),
        id: clean(node.id).slice(0, 80),
        class: clean(typeof node.className === "string" ? node.className : "").slice(0, 160),
        role: clean(node.getAttribute && node.getAttribute("role")).slice(0, 50),
        position: clean(style.position),
        zIndex: clean(style.zIndex),
        box: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)],
        text: nodeText(node).replace(/(password|passwd|pwd|token|cookie|authorization)\s*[:=]\s*[^\n,;]+/gi, "$1=[已隐藏]").slice(0, 700),
      }
    } catch (_) { return null }
  }

  const visibleDiagnostics = () => {
    const result = []
    const seen = new Set()
    for (const root of rootList) {
      let nodes = []
      try { nodes = [...root.querySelectorAll("*")].slice(0, 3000) } catch (_) {}
      for (const node of nodes) {
        const text = nodeText(node)
        if (!text || text.length < 2 || text.length > 1800 || !elementVisible(node)) continue
        let interesting = /任课教师|授课教师|主讲教师|教师姓名|老师/.test(text)
        try {
          const style = node.ownerDocument.defaultView.getComputedStyle(node)
          interesting ||= style.position === "fixed" || style.position === "absolute" || (style.zIndex !== "auto" && Number(style.zIndex) > 1)
        } catch (_) {}
        if (!interesting || seen.has(text)) continue
        const description = describeNode(node)
        if (description) result.push(description)
        seen.add(text)
        if (result.length >= 50) return result
      }
    }
    return result
  }

  for (const root of rootList) {
    try {
      const doc = root.nodeType === 9 ? root : root.ownerDocument
      const view = doc.defaultView
      const observerTarget = root.nodeType === 9 ? root.documentElement : root
      if (!root.__tianyangTeacherObserver && view.MutationObserver && observerTarget) {
        root.__tianyangTeacherObserver = new view.MutationObserver((mutations) => {
          for (const mutation of mutations) {
            const candidates = [mutation.target, ...mutation.addedNodes]
            for (const node of candidates) {
              const value = clean(node && (node.innerText || node.textContent || ""))
              if (value && value.length < 1800 && /任课教师|授课教师|主讲教师|教师姓名|老师/.test(value)) {
                teacherState.observedTexts.push(value)
              }
              const description = node && node.nodeType === 1 ? describeNode(node) : null
              if (description && (description.text || mutation.attributeName)) {
                teacherState.observedMutations.push({ type: mutation.type, attribute: mutation.attributeName || "", node: description })
              }
              if (node && node.attributes) {
                for (const attribute of node.attributes) {
                  if (/teacher|tooltip|popover|content|title/i.test(attribute.name) && attribute.value) {
                    teacherState.observedTexts.push(attribute.value)
                  }
                }
              }
            }
          }
          if (teacherState.observedTexts.length > 30) teacherState.observedTexts.splice(0, teacherState.observedTexts.length - 30)
          if (teacherState.observedMutations.length > 40) teacherState.observedMutations.splice(0, teacherState.observedMutations.length - 40)
        })
        root.__tianyangTeacherObserver.observe(observerTarget, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class", "style", "aria-hidden", "title", "data-title", "data-content", "data-original-title", "aria-label", "aria-describedby"],
        })
      }
    } catch (_) {}
  }
  const tooltipEntries = documents.flatMap((doc) => {
    try { return [...doc.querySelectorAll(tooltipSelectors)].filter(elementVisible).map(nodeText) } catch (_) { return [] }
  })

  if (teacherState.pendingCode) {
    const pendingEntry = parsed.find((entry) => entry.code === teacherState.pendingCode)
    const belongsToPendingCourse = (value) => clean(value).includes(teacherState.pendingCode)
    const rawMetadata = pendingEntry ? attributeText(pendingEntry.node) : ""
    const pendingMetadata = belongsToPendingCourse(rawMetadata) ? rawMetadata : ""
    const observedText = teacherState.observedTexts.splice(0).filter(belongsToPendingCourse).join("\n")
    const tooltipText = tooltipEntries.filter(belongsToPendingCourse).join("\n")
    const visibleNow = visibleDiagnostics()
    const baseline = new Set(teacherState.pendingBaseline || [])
    const newlyVisible = visibleNow.filter((item) => !baseline.has(item.text) && belongsToPendingCourse(item.text))
    const mutationSnapshot = teacherState.observedMutations.splice(0)
      .filter((mutation) => belongsToPendingCourse(mutation && mutation.node && mutation.node.text))
    const found = extractTeachers(`${pendingMetadata}\n${tooltipText}\n${observedText}\n${newlyVisible.map((item) => item.text).join("\n")}`)
    const attempt = {
      attempt: Number(teacherState.pendingAttempts || 0) + 1,
      found,
      metadata: pendingMetadata.slice(0, 1000),
      knownTooltipText: tooltipText.slice(0, 1800),
      observedText: observedText.slice(0, 1800),
      newlyVisible: newlyVisible.slice(0, 16),
      mutations: mutationSnapshot.slice(0, 16),
    }
    const currentDiagnostics = teacherState.diagnosticsByCode[teacherState.pendingCode] || { attempts: [] }
    currentDiagnostics.attempts.push(attempt)
    currentDiagnostics.network = pendingEntry ? networkDiagnostics(pendingEntry) : []
    teacherState.diagnosticsByCode[teacherState.pendingCode] = currentDiagnostics
    if (found.length) teacherState.teachersByCode[teacherState.pendingCode] = found
    if (found.length || Number(teacherState.pendingAttempts || 0) >= 2) {
      teacherState.scannedCodes[teacherState.pendingCode] = true
      teacherState.pendingCode = ""
      teacherState.pendingAttempts = 0
      teacherState.pendingBaseline = []
    } else {
      teacherState.pendingAttempts = Number(teacherState.pendingAttempts || 0) + 1
    }
  }

  for (const course of parsed) {
    const payloadTeachers = teachersFromPayloads(course)
    if (course.teachers.length || payloadTeachers.length) {
      const existing = teacherState.teachersByCode[course.code] || []
      teacherState.teachersByCode[course.code] = [...new Set([...existing, ...course.teachers, ...payloadTeachers])]
    }
  }
  for (const course of byPlacement.values()) {
    course.teachers = [...new Set([...(course.teachers || []), ...(teacherState.teachersByCode[course.code] || [])])]
  }

  const courses = [...byPlacement.values()].map((course) => ({
    id: `${course.code}-${course.day}-${course.startSection}-${course.endSection}-${compact(course.room)}`,
    ...course,
    color: [...course.code].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 8,
  })).sort((a, b) => a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name, "zh-CN"))

  if (courses.length >= 3 && /^20\d{2}-\d{2}-\d{2}$/.test(startsOn)) {
    const nextTeacherCourse = parsed.find((course) => course.code === teacherState.pendingCode) || parsed.find((course) => !course.teachers.length
      && !(teacherState.teachersByCode[course.code] || []).length
      && !teacherState.scannedCodes[course.code])
    if (nextTeacherCourse) {
      const courseNode = nextTeacherCourse.node
      const hoverChain = []
      for (let current = courseNode, depth = 0; current && depth < 7; current = current.parentElement, depth += 1) hoverChain.push(current)
      const node = hoverChain.find((current) => {
        try {
          if (current.attributes && [...current.attributes].some((attribute) => /tooltip|popover|content|title/i.test(attribute.name))) return true
          if (current.matches && current.matches(".course,.course-item,.event,.fc-event,[data-toggle=tooltip],[data-bs-toggle=tooltip]")) return true
          return current.ownerDocument.defaultView.getComputedStyle(current).cursor === "pointer"
        } catch (_) { return false }
      }) || courseNode
      try {
        teacherState.observedTexts.splice(0)
        teacherState.observedMutations.splice(0)
        if (teacherState.pendingCode !== nextTeacherCourse.code) {
          teacherState.pendingCode = nextTeacherCourse.code
          teacherState.pendingAttempts = 0
          teacherState.pendingBaseline = visibleDiagnostics().map((item) => item.text)
        }
        node.scrollIntoView({ block: "center", inline: "center", behavior: "auto" })
        const view = node.ownerDocument.defaultView
        const rect = node.getBoundingClientRect()
        const init = { bubbles: true, cancelable: true, view, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
        if (view.PointerEvent) {
          node.dispatchEvent(new view.PointerEvent("pointerover", init))
          node.dispatchEvent(new view.PointerEvent("pointermove", init))
        }
        node.dispatchEvent(new view.MouseEvent("mouseenter", { ...init, bubbles: false }))
        node.dispatchEvent(new view.MouseEvent("mouseover", init))
        node.dispatchEvent(new view.MouseEvent("mousemove", init))
        if (typeof node.focus === "function") node.focus({ preventScroll: true })
        let hoverX = rect.left + rect.width / 2
        let hoverY = rect.top + rect.height / 2
        let hoverWindow = node.ownerDocument.defaultView
        while (hoverWindow !== window && hoverWindow.frameElement) {
          const frameRect = hoverWindow.frameElement.getBoundingClientRect()
          hoverX += frameRect.left
          hoverY += frameRect.top
          hoverWindow = hoverWindow.parent
        }
        return {
          action: "teacher-wait",
          x: hoverX / window.innerWidth,
          y: hoverY / window.innerHeight,
          teacherDone: Object.keys(teacherState.scannedCodes).length,
          teacherTotal: [...new Set(parsed.map((course) => course.code))].length,
          courseCount: courses.length,
          delayMs: 1200 + Number(teacherState.pendingAttempts || 0) * 600,
        }
      } catch (_) {
        teacherState.scannedCodes[nextTeacherCourse.code] = true
      }
    }
    return {
      action: "data",
      schedule: { term, startsOn, importedAt: new Date().toISOString(), source: "web", courses },
      diagnostics: [...new Set(parsed.map((course) => course.code))].map((code) => {
        const course = parsed.find((entry) => entry.code === code)
        return {
          code,
          name: course ? course.name : "",
          teachers: teacherState.teachersByCode[code] || [],
          detail: teacherState.diagnosticsByCode[code] || { attempts: [], network: course ? networkDiagnostics(course) : [] },
        }
      }),
    }
  }
  return { action: "none", courseCount: courses.length, hasStartDate: Boolean(startsOn) }
})()
