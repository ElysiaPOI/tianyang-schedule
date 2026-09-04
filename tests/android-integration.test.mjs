import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")

test("android build uses the offline static export", async () => {
  const [config, pkg, gradle] = await Promise.all([
    read("next.config.ts"),
    read("package.json"),
    read("android/app/build.gradle"),
  ])
  assert.match(config, /output: "export"/)
  assert.match(pkg, /build:android-web/)
  assert.match(gradle, /dist\/client/)
})

test("android import keeps credentials inside the official web page", async () => {
  const [main, importer, network, extractor] = await Promise.all([
    read("android/app/src/main/java/com/elysiapoi/tianyangschedule/MainActivity.java"),
    read("android/app/src/main/java/com/elysiapoi/tianyangschedule/EducationImportActivity.java"),
    read("android/app/src/main/res/xml/network_security_config.xml"),
    read("android/app/src/main/res/raw/dlut_schedule_extractor.js"),
  ])
  assert.match(main, /addJavascriptInterface\(new AndroidBridge\(\), "TianyangAndroid"\)/)
  assert.doesNotMatch(importer, /addJavascriptInterface/)
  assert.match(importer, /jxgl\.dlut\.edu\.cn\/student\/home/)
  assert.match(importer, /setUseWideViewPort\(true\)/)
  assert.match(importer, /toDesktopUserAgent/)
  assert.match(importer, /MIXED_CONTENT_ALWAYS_ALLOW/)
  assert.match(importer, /WebSettings\.LOAD_DEFAULT/)
  assert.match(importer, /onReceivedError/)
  assert.match(importer, /onReceivedHttpError/)
  assert.doesNotMatch(importer, /LOAD_NO_CACHE|clearCache\(true\)|TianyangScheduleImport/)
  assert.match(importer, /isDlutHttpUri/)
  assert.match(importer, /读取当前课表/)
  assert.match(importer, /readCurrentSchedule/)
  assert.match(importer, /复制诊断/)
  assert.match(importer, /teacher-tooltip-1/)
  assert.match(importer, /ClipboardManager/)
  assert.match(extractor, /action: "data"/)
  assert.match(extractor, /source: "web"/)
  assert.match(extractor, /teacher-wait/)
  assert.match(extractor, /mouseenter/)
  assert.match(extractor, /scrollIntoView/)
  assert.match(extractor, /MutationObserver/)
  assert.match(extractor, /__tianyangScheduleNetworkPayloads/)
  assert.match(extractor, /pendingAttempts/)
  assert.match(extractor, /newlyVisible/)
  assert.match(extractor, /attributeFilter: \["class", "style", "aria-hidden"/)
  assert.match(extractor, /diagnostics:/)
  assert.match(importer, /EXTRA_SCHEDULE_JSON/)
  assert.match(importer, /isValidExtractedSchedule/)
  assert.match(main, /tianyang:android-schedule-ready/)
  assert.match(importer, /WebViewCompat\.addDocumentStartJavaScript/)
  assert.match(importer, /WebViewFeature\.DOCUMENT_START_SCRIPT/)
  assert.match(importer, /MotionEvent\.ACTION_HOVER_MOVE/)
  assert.match(importer, /removeAllCookies/)
  assert.doesNotMatch(importer, /PrintedPdfDocument|capturePicture|DownloadListener|scheduleAutomationStep/)
  assert.doesNotMatch(extractor, /打印大课表|导出至一个PDF文件|domClicked|action: "schedule"|action: "pdf"/)
  assert.match(network, /base-config cleartextTrafficPermitted="true"/)
  assert.match(network, /includeSubdomains="true">dlut\.edu\.cn/)
  assert.doesNotMatch(importer, /password|passwd|账号密码/i)
})

test("web app exposes exactly webpage reading and local file import", async () => {
  const source = await read("app/schedule-app.tsx")
  assert.match(source, /openTeachingSystem/)
  assert.match(source, /教务系统读取/)
  assert.match(source, /从文件导入/)
  assert.match(source, /parseScheduleFile/)
  assert.match(source, /tianyang:android-schedule-ready/)
  assert.match(source, /scheduleFromTeachingSystem/)
  assert.doesNotMatch(source, /tianyang:android-pdf-ready|importPdf/)
})

test("teaching-system extractor reads course cards without exporting PDF", async () => {
  const source = await read("android/app/src/main/res/raw/dlut_schedule_extractor.js")
  const block = (innerText) => ({
    innerText,
    value: "",
    textContent: innerText,
    children: [],
    querySelectorAll: () => [],
  })
  const cards = [
    block("1000000000001.01\n测试课程甲\n教学楼 A101 (1~10周) 2 (1,2)"),
    block("1000000000002.01\n测试课程乙\n体育馆 1号场 (2~16(双)周) 3 (1,2)"),
    block("1000000000003.01\n测试课程丙\n教学楼 B205 (1~8周) 5 (3,4)"),
  ]
  const document = {
    body: { innerText: "2026-2027学年第一学期\n第1周 2026-08-31—2026-09-06" },
    documentElement: { innerHTML: "2026-2027学年第一学期 2026-08-31" },
    querySelectorAll: (selector) => selector === "iframe" ? [] : selector.startsWith("td,") ? cards : [],
  }
  const window = {}
  const result = vm.runInNewContext(source, { document, window, Date, Map, Set })
  assert.equal(result.action, "data")
  assert.equal(result.schedule.startsOn, "2026-08-31")
  assert.equal(result.schedule.source, "web")
  assert.equal(result.schedule.courses.length, 3)
  assert.deepEqual([...result.schedule.courses[1].weeks], [2, 4, 6, 8, 10, 12, 14, 16])
})

test("teaching-system extractor collects teacher names from hover details", async () => {
  const source = await read("android/app/src/main/res/raw/dlut_schedule_extractor.js")
  let tooltipVisible = false
  class TestEvent {
    constructor(type) { this.type = type }
  }
  const window = {
    PointerEvent: TestEvent,
    MouseEvent: TestEvent,
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1", cursor: "default" }),
  }
  const document = {
    body: { innerText: "2026-2027学年第一学期\n第1周 2026-08-31—2026-09-06" },
    documentElement: { innerHTML: "2026-2027学年第一学期 2026-08-31" },
    defaultView: window,
    location: { href: "http://jxgl.dlut.edu.cn/student/schedule" },
    getElementById: () => null,
  }
  const makeNode = (innerText) => ({
    innerText,
    value: "",
    textContent: innerText,
    children: [],
    parentElement: null,
    ownerDocument: document,
    attributes: [],
    querySelectorAll: () => [],
    getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 60 }),
    scrollIntoView: () => {},
    dispatchEvent: (event) => { if (event.type === "mouseover") tooltipVisible = true },
    focus: () => {},
  })
  const cards = [
    makeNode("1000000000001.01\n测试课程甲\n教学楼 A101 (1~10周) 2 (1,2)"),
    makeNode("1000000000001.01\n测试课程甲\n教学楼 A101 (1~10周) 3 (1,2)"),
    makeNode("1000000000001.01\n测试课程甲\n教学楼 A101 (1~10周) 5 (1,2)"),
  ]
  const tooltip = makeNode("任课教师：张三\n课程性质：必修")
  document.querySelectorAll = (selector) => {
    if (selector === "iframe") return []
    if (selector.startsWith("td,")) return cards
    if (selector.includes("[role=tooltip]")) return tooltipVisible ? [tooltip] : []
    return []
  }

  const context = { document, window, Date, Map, Set }
  const first = vm.runInNewContext(source, context)
  assert.equal(first.action, "teacher-wait")
  const second = vm.runInNewContext(source, context)
  assert.equal(second.action, "data")
  assert.deepEqual([...second.schedule.courses[0].teachers], ["张三"])
})

test("teaching-system extractor reads teachers captured from schedule responses", async () => {
  const source = await read("android/app/src/main/res/raw/dlut_schedule_extractor.js")
  const block = (innerText) => ({ innerText, value: "", textContent: innerText, children: [], querySelectorAll: () => [] })
  const cards = [
    block("1000000000001.01\n测试课程甲\n教学楼 A101 (1~10周) 2 (1,2)"),
    block("1000000000002.01\n测试课程乙\n教学楼 A102 (1~10周) 3 (3,4)"),
    block("1000000000003.01\n测试课程丙\n教学楼 A103 (1~10周) 4 (5,6)"),
  ]
  const window = { __tianyangScheduleNetworkPayloads: [JSON.stringify([
    { courseCode: "1000000000001.01", courseName: "测试课程甲", teacherName: "张三" },
    { courseCode: "1000000000002.01", courseName: "测试课程乙", jsmc: "李四" },
    { courseCode: "1000000000003.01", courseName: "测试课程丙", instructor: "王五" },
  ])] }
  const document = {
    body: { innerText: "2026-2027学年第一学期\n第1周 2026-08-31—2026-09-06" },
    documentElement: { innerHTML: "2026-2027学年第一学期 2026-08-31" },
    querySelectorAll: (selector) => selector === "iframe" ? [] : selector.startsWith("td,") ? cards : [],
  }
  const result = vm.runInNewContext(source, { document, window, Date, Map, Set })
  assert.equal(result.action, "data")
  assert.deepEqual([...result.schedule.courses[0].teachers], ["张三"])
  assert.deepEqual([...result.schedule.courses[1].teachers], ["李四"])
  assert.deepEqual([...result.schedule.courses[2].teachers], ["王五"])
})

test("android webview opens a multi-format document picker", async () => {
  const main = await read("android/app/src/main/java/com/elysiapoi/tianyangschedule/MainActivity.java")
  assert.match(main, /onShowFileChooser/)
  assert.match(main, /Intent\.ACTION_OPEN_DOCUMENT/)
  assert.match(main, /setType\("\*\/\*"\)/)
  assert.match(main, /Intent\.EXTRA_MIME_TYPES/)
  assert.match(main, /FILE_PICKER_REQUEST/)
  assert.match(main, /spreadsheetml|text\/csv|text\/calendar/)
  assert.match(main, /FileChooserParams\.parseResult/)
  assert.match(main, /setAllowContentAccess\(true\)/)
})

test("local schedule importer supports common course file formats", async () => {
  const source = await read("lib/schedule-file-parser.ts")
  assert.match(source, /parseDlutSchedulePdf/)
  assert.match(source, /parseXlsx/)
  assert.match(source, /parseDelimited/)
  assert.match(source, /parseIcs/)
  assert.match(source, /parseHtmlTable/)
  assert.match(source, /parseJson/)
  assert.match(source, /暂不支持旧版二进制 XLS/)
})

test("PDF import uses the legacy build for older Android WebViews", async () => {
  const parser = await read("lib/dlut-pdf-parser.ts")
  assert.match(parser, /pdfjs-dist\/legacy\/build\/pdf\.mjs/)
  assert.match(parser, /pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs\?url/)
  assert.doesNotMatch(parser, /import\("pdfjs-dist"\)/)
})
