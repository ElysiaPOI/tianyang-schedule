import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")

test("schedule view supports horizontal swipes", async () => {
  const [source, css] = await Promise.all([
    read("app/schedule-app.tsx"),
    read("app/globals.css"),
  ])
  assert.match(source, /startViewSwipe/)
  assert.match(source, /finishViewSwipe/)
  assert.match(source, /changeView\(dx < 0 \? "week" : "day"\)/)
  assert.match(css, /touch-action:\s*pan-y/)
  assert.match(css, /schedule-view-in-forward/)
  assert.match(css, /schedule-view-in-backward/)
  assert.match(css, /\.21s cubic-bezier/)
})

test("current day is outlined in the weekly timetable", async () => {
  const [source, css] = await Promise.all([
    read("app/schedule-app.tsx"),
    read("app/globals.css"),
  ])
  assert.match(source, /week === todayWeek/)
  assert.match(source, /today-column-highlight/)
  assert.match(source, /gridColumn: `\$\{todayDay \+ 1\} \/ \$\{todayDay \+ 2\}`/)
  assert.match(css, /\.today-column-highlight/)
  assert.match(css, /border:\s*2px dashed/)
})

test("web imports omit unknown teachers from the main timetable", async () => {
  const source = await read("app/schedule-app.tsx")
  assert.match(source, /course\.teachers\.length > 0 && <span><UserRound/)
  assert.match(source, /任课教师<\/small>\{course\.teachers\.join\("、"\) \|\| "未获取"/)
  assert.match(source, /parsed\.source === "web" \? \[\]/)
  assert.match(source, /schedule\.courses\.map\(\(course\) => \(\{ \.\.\.course, teachers: \[\] \}\)\)/)
  assert.doesNotMatch(source, /教师未获取/)
})
