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
