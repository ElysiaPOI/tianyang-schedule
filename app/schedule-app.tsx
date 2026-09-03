"use client"

import { useEffect, useMemo, useRef, useState, type TouchEvent } from "react"
import { AlertTriangle, Ban, CalendarClock, CalendarDays, ChevronLeft, ChevronRight, Clock3, DatabaseBackup, Download, FileUp, FlaskConical, GraduationCap, MapPin, NotebookPen, PencilLine, Plus, RotateCcw, ShieldCheck, Trash2, Upload, UserRound } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Toaster } from "@/components/ui/sonner"
import { parseScheduleFile } from "@/lib/schedule-file-parser"
import { compactWeeks, currentWeek, dateForWeekday, dayNames, initialSchedule, timeSlots, weekRange, type Course, type CourseOverride, type Schedule } from "@/lib/schedule"

declare global {
  interface Window {
    TianyangAndroid?: {
      openTeachingSystem: () => void
      platform?: () => string
    }
  }
}

type AndroidScheduleReadyEvent = CustomEvent<unknown>

const storageKey = "tianyang-schedule-v1"
const colors = ["course-blue", "course-violet", "course-cyan", "course-emerald", "course-amber", "course-rose", "course-indigo", "course-slate"]
const dayOfWeek = (date = new Date()) => date.getDay() === 0 ? 7 : date.getDay()
const coursesInSlot = (courses: Course[], day: number, start: number, end: number) =>
  courses.filter((course) => course.day === day && course.startSection <= start && course.endSection >= end)

function coursesForWeek(courses: Course[], week: number) {
  return courses.filter((course) => course.weeks.includes(week)).map((course) => {
    const override = course.overrides?.find((item) => item.week === week)
    if (!override) return course
    if (override.cancelled) return { ...course, adjusted: true, cancelled: true }
    return {
      ...course,
      day: override.day ?? course.day,
      startSection: override.startSection ?? course.startSection,
      endSection: override.endSection ?? course.endSection,
      room: override.room ?? course.room,
      teachers: override.teachers ?? course.teachers,
      adjusted: true,
      cancelled: false,
    }
  })
}

type CourseConflict = { week: number; course: Course }

function findCourseConflicts(
  courses: Course[],
  placement: { weeks: number[]; day: number; startSection: number; endSection: number },
  ignoreCourseId?: string,
) {
  const conflicts: CourseConflict[] = []
  for (const week of placement.weeks) {
    for (const course of coursesForWeek(courses, week)) {
      if (course.id === ignoreCourseId || course.cancelled || course.day !== placement.day) continue
      const overlaps = course.startSection <= placement.endSection && course.endSection >= placement.startSection
      if (overlaps) conflicts.push({ week, course })
    }
  }
  return conflicts
}

function conflictReminder(conflicts: CourseConflict[]) {
  if (!conflicts.length) return ""
  const first = conflicts[0]
  const more = conflicts.length - 1
  return `第 ${first.week} 周${dayNames[first.course.day - 1]}第 ${first.course.startSection}–${first.course.endSection} 节已有“${first.course.name}”${more ? `，另有 ${more} 处重合` : ""}；仍可保存。`
}

function courseClock(course: Course) {
  const startSlot = timeSlots.find((slot) => slot.start === course.startSection)
  const endSlot = timeSlots.find((slot) => slot.end === course.endSection)
  if (!startSlot || !endSlot) return null
  const startText = startSlot.time.split("–")[0]
  const endText = endSlot.time.split("–")[1]
  const minutes = (value: string) => {
    const [hours, mins] = value.split(":").map(Number)
    return hours * 60 + mins
  }
  return { startText, endText, startMinutes: minutes(startText), endMinutes: minutes(endText) }
}

function liveCourseStatus(schedule: Schedule, now: Date) {
  const week = currentWeek(schedule.startsOn, now)
  const day = dayOfWeek(now)
  const minute = now.getHours() * 60 + now.getMinutes()
  const courses = coursesForWeek(schedule.courses, week)
    .filter((course) => course.day === day && !course.cancelled)
    .map((course) => ({ course, clock: courseClock(course) }))
    .filter((item): item is { course: Course; clock: NonNullable<ReturnType<typeof courseClock>> } => Boolean(item.clock))
    .sort((a, b) => a.clock.startMinutes - b.clock.startMinutes)
  const current = courses.find((item) => item.clock.startMinutes <= minute && minute < item.clock.endMinutes)
  if (current) return { kind: "current", text: `正在上课：${current.course.name} · ${current.clock.endText} 下课` }
  const next = courses.find((item) => item.clock.startMinutes > minute)
  if (next) return { kind: "next", text: `下一节：${next.course.name} · ${next.clock.startText} · ${compactRoom(next.course.room)}` }
  return courses.length ? { kind: "done", text: "今天课程已结束" } : { kind: "empty", text: "今天没有课" }
}

type DraftCourse = {
  name: string
  teacher: string
  room: string
  day: string
  slot: string
  repeatMode: "once" | "weekly" | "custom"
  weeks: number[]
}

type AdjustmentDraft = {
  day: string
  slot: string
  room: string
  teacher: string
}

type BackupEnvelope = {
  app: "tianyang-schedule"
  version: 1
  exportedAt: string
  schedule: Schedule
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isCourseBackup(value: unknown): value is Course {
  if (!isRecord(value)) return false
  const validOverrides = value.overrides === undefined || (Array.isArray(value.overrides) && value.overrides.every((override) => isRecord(override) && typeof override.id === "string" && Number.isInteger(override.week)))
  return validOverrides
    && typeof value.id === "string"
    && typeof value.name === "string"
    && Array.isArray(value.teachers)
    && value.teachers.every((teacher) => typeof teacher === "string")
    && typeof value.room === "string"
    && typeof value.day === "number"
    && typeof value.startSection === "number"
    && typeof value.endSection === "number"
    && Array.isArray(value.weeks)
    && value.weeks.every((week) => Number.isInteger(week) && week > 0)
    && typeof value.color === "number"
}

function scheduleFromBackup(value: unknown): Schedule | null {
  if (!isRecord(value) || value.app !== "tianyang-schedule" || value.version !== 1 || !isRecord(value.schedule)) return null
  const schedule = value.schedule
  if (typeof schedule.term !== "string" || typeof schedule.startsOn !== "string" || typeof schedule.importedAt !== "string" || !Array.isArray(schedule.courses) || !schedule.courses.every(isCourseBackup)) return null
  return schedule as unknown as Schedule
}

function scheduleFromTeachingSystem(value: unknown): Schedule | null {
  if (!isRecord(value) || typeof value.term !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(String(value.startsOn))
    || typeof value.importedAt !== "string" || value.source !== "web" || !Array.isArray(value.courses)
    || value.courses.length < 3 || !value.courses.every(isCourseBackup)) return null
  return value as unknown as Schedule
}

const shortCourseNames: Record<string, string> = {
  "人工智能原理与应用": "人工智能原理",
  "思想政治理论课社会实践": "社会实践",
}

function shortCourseName(name: string) {
  if (name.length < 8) return name
  return shortCourseNames[name] ?? `${name.slice(0, 7)}…`
}

function compactRoom(room: string) {
  const trimmed = room.trim()
  const explicitCode = trimmed.match(/(?:^|\s)([A-Za-z\u4e00-\u9fff]{1,2}\d{2,4})$/)?.[1]
  if (explicitCode) return explicitCode
  const number = trimmed.match(/(\d{2,4})$/)?.[1]
  if (number) {
    const letter = trimmed.slice(0, -number.length).match(/[A-Za-z]$/)?.[0]
    if (letter) return `${letter}${number}`
    const prefix = trimmed.includes("建筑") ? "建" : trimmed.includes("综合") ? "综" : trimmed.match(/[\u4e00-\u9fff]/)?.[0]
    if (prefix) return `${prefix}${number}`
  }
  return trimmed.split(/\s+/).at(-1) || trimmed
}

function CourseBar({ course, weekView = false, onOpen }: { course: Course; weekView?: boolean; onOpen: () => void }) {
  return <button className={`course-bar ${weekView ? "week-bar" : ""} ${course.cancelled ? "cancelled" : ""} ${colors[course.color % colors.length]}`} onClick={onOpen} aria-label={`查看${course.name}详情`}>
    <span className="course-bar-main">
      {course.cancelled ? <Ban className="course-kind-icon" /> : course.custom ? <FlaskConical className="course-kind-icon" /> : course.adjusted ? <CalendarClock className="course-kind-icon" /> : null}
      <strong>{course.cancelled ? `停课 · ${weekView ? shortCourseName(course.name) : course.name}` : weekView ? shortCourseName(course.name) : course.name}</strong>
      {course.note && <NotebookPen className="note-indicator" aria-label="有备注" />}
    </span>
    {!weekView && (course.cancelled ? <span className="cancelled-meta">本周已停课</span> : <span className="course-bar-meta"><span><MapPin /><span className="room-text">{course.room}</span></span><span><UserRound /><em>{course.teachers.join("、") || "教师未获取"}</em></span></span>)}
    {weekView && <small>{course.cancelled ? "本周停课" : compactRoom(course.room)}</small>}
  </button>
}

function courseDraft(course: Course | null, selectedWeek: number, selectedDay: number, selectedSlot: number, totalWeeks: number): DraftCourse {
  if (!course) return { name: "", teacher: "", room: "", day: String(selectedDay), slot: String(selectedSlot), repeatMode: "once", weeks: [selectedWeek] }
  const everyWeek = course.weeks.length === totalWeeks && course.weeks.every((value, index) => value === index + 1)
  return {
    name: course.name,
    teacher: course.teachers.join("、"),
    room: course.room === "教室待定" ? "" : course.room,
    day: String(course.day),
    slot: String(course.startSection),
    repeatMode: course.weeks.length === 1 ? "once" : everyWeek ? "weekly" : "custom",
    weeks: [...course.weeks],
  }
}

function CourseFormDialog({
  open,
  onOpenChange,
  selectedWeek,
  selectedDay,
  selectedSlot,
  totalWeeks,
  suppressAutoFocus,
  course,
  courses,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedWeek: number
  selectedDay: number
  selectedSlot: number
  totalWeeks: number
  suppressAutoFocus: boolean
  course: Course | null
  courses: Course[]
  onSave: (draft: DraftCourse) => void
}) {
  const [draft, setDraft] = useState<DraftCourse>(() => courseDraft(course, selectedWeek, selectedDay, selectedSlot, totalWeeks))

  useEffect(() => {
    if (open) setDraft(courseDraft(course, selectedWeek, selectedDay, selectedSlot, totalWeeks))
  }, [open, course, selectedWeek, selectedDay, selectedSlot, totalWeeks])

  function toggleWeek(value: number, checked: boolean) {
    setDraft((current) => ({
      ...current,
      weeks: checked ? [...new Set([...current.weeks, value])].sort((a, b) => a - b) : current.weeks.filter((week) => week !== value),
    }))
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!draft.name.trim()) {
      toast.error("请填写课程名称")
      return
    }
    const weeks = resolvedWeeks.length ? resolvedWeeks : [selectedWeek]
    onSave({ ...draft, weeks })
    onOpenChange(false)
  }

  const editing = Boolean(course)
  const selectedSlotRange = timeSlots.find((slot) => slot.start === Number(draft.slot)) ?? timeSlots[0]
  const resolvedWeeks = draft.repeatMode === "once"
    ? [selectedWeek]
    : draft.repeatMode === "weekly"
      ? Array.from({ length: totalWeeks }, (_, index) => index + 1)
      : draft.weeks
  const missingWeeks = draft.repeatMode === "custom" && resolvedWeeks.length === 0
  const effectiveWeeks = missingWeeks ? [selectedWeek] : resolvedWeeks
  const conflicts = findCourseConflicts(courses, {
    weeks: effectiveWeeks,
    day: Number(draft.day),
    startSection: selectedSlotRange.start,
    endSection: selectedSlotRange.end,
  }, course?.id)
  const conflictMessage = conflictReminder(conflicts)
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="add-dialog" onOpenAutoFocus={(event) => { if (suppressAutoFocus || editing) event.preventDefault() }}>
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>{editing ? "编辑临时课程" : "添加临时课程"}</DialogTitle>
          <DialogDescription>{editing ? "修改后会同步更新到所有已选择的周次。" : "实验课、临时调课都可以添加。"}</DialogDescription>
        </DialogHeader>
        <div className="form-grid">
          <div className="field full"><Label htmlFor="course-name">课程名称</Label><Input id="course-name" placeholder="例如：计算机网络实验" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
          <div className="field"><Label>星期</Label><Select value={draft.day} onValueChange={(value) => setDraft({ ...draft, day: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{dayNames.map((name, index) => <SelectItem key={name} value={String(index + 1)}>{name}</SelectItem>)}</SelectContent></Select></div>
          <div className="field"><Label>上课时间</Label><Select value={draft.slot} onValueChange={(value) => setDraft({ ...draft, slot: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{timeSlots.map((slot) => <SelectItem key={slot.start} value={String(slot.start)}>第 {slot.start}–{slot.end} 节 · {slot.time}</SelectItem>)}</SelectContent></Select></div>
          <div className="field"><Label htmlFor="course-room">教室</Label><Input id="course-room" placeholder="例如：知行楼 205" value={draft.room} onChange={(event) => setDraft({ ...draft, room: event.target.value })} /></div>
          <div className="field"><Label htmlFor="course-teacher">教师</Label><Input id="course-teacher" placeholder="选填" value={draft.teacher} onChange={(event) => setDraft({ ...draft, teacher: event.target.value })} /></div>
          <fieldset className="field full recurrence-field">
            <legend>重复方式</legend>
            <RadioGroup value={draft.repeatMode} onValueChange={(value) => setDraft({ ...draft, repeatMode: value as DraftCourse["repeatMode"] })} className="recurrence-options">
              <Label className="recurrence-option"><RadioGroupItem value="once" /><span><strong>仅本周</strong><small>只在第 {selectedWeek} 周显示</small></span></Label>
              <Label className="recurrence-option"><RadioGroupItem value="weekly" /><span><strong>每周重复</strong><small>第 1–{totalWeeks} 周都显示</small></span></Label>
              <Label className="recurrence-option"><RadioGroupItem value="custom" /><span><strong>自选周次</strong><small>可一次选择多个周次</small></span></Label>
            </RadioGroup>
            {draft.repeatMode === "custom" && <div className="week-picker" aria-label="选择上课周次">
              {Array.from({ length: totalWeeks }, (_, index) => index + 1).map((value) => <Label className="week-check" key={value}><Checkbox checked={draft.weeks.includes(value)} onCheckedChange={(checked) => toggleWeek(value, checked === true)} /><span>{value}</span></Label>)}
            </div>}
          </fieldset>
        </div>
        {(missingWeeks || conflictMessage) && <div className="form-reminder" role="status">
          <AlertTriangle />
          <span>
            {missingWeeks && <>尚未选择周次，保存时将按第 {selectedWeek} 周处理。</>}
            {missingWeeks && conflictMessage && <br />}
            {conflictMessage}
          </span>
        </div>}
        <DialogFooter><Button type="submit">{editing ? <PencilLine /> : <Plus />}{editing ? "保存修改" : "添加到课表"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}

function CourseAdjustmentDialog({
  course,
  week,
  open,
  onOpenChange,
  courses,
  onSave,
}: {
  course: Course | null
  week: number
  open: boolean
  onOpenChange: (open: boolean) => void
  courses: Course[]
  onSave: (draft: AdjustmentDraft) => void
}) {
  const [draft, setDraft] = useState<AdjustmentDraft>({ day: "1", slot: "1", room: "", teacher: "" })

  useEffect(() => {
    if (open && course) setDraft({ day: String(course.day), slot: String(course.startSection), room: course.room === "教室待定" ? "" : course.room, teacher: course.teachers.join("、") })
  }, [open, course])

  if (!course) return null
  const selectedSlotRange = timeSlots.find((slot) => slot.start === Number(draft.slot)) ?? timeSlots[0]
  const conflictMessage = conflictReminder(findCourseConflicts(courses, {
    weeks: [week],
    day: Number(draft.day),
    startSection: selectedSlotRange.start,
    endSection: selectedSlotRange.end,
  }, course.id))
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="adjust-dialog" onOpenAutoFocus={(event) => event.preventDefault()}>
      <form onSubmit={(event) => { event.preventDefault(); onSave(draft); onOpenChange(false) }}>
        <DialogHeader>
          <DialogTitle>调整第 {week} 周课程</DialogTitle>
          <DialogDescription>{course.name} · 只修改这一周，不影响其他周次。</DialogDescription>
        </DialogHeader>
        <div className="form-grid">
          <div className="field"><Label>星期</Label><Select value={draft.day} onValueChange={(value) => setDraft({ ...draft, day: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{dayNames.map((name, index) => <SelectItem key={name} value={String(index + 1)}>{name}</SelectItem>)}</SelectContent></Select></div>
          <div className="field"><Label>上课时间</Label><Select value={draft.slot} onValueChange={(value) => setDraft({ ...draft, slot: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{timeSlots.map((slot) => <SelectItem key={slot.start} value={String(slot.start)}>第 {slot.start}–{slot.end} 节 · {slot.time}</SelectItem>)}</SelectContent></Select></div>
          <div className="field"><Label htmlFor="adjust-room">教室</Label><Input id="adjust-room" value={draft.room} onChange={(event) => setDraft({ ...draft, room: event.target.value })} placeholder="教室待定" /></div>
          <div className="field"><Label htmlFor="adjust-teacher">教师</Label><Input id="adjust-teacher" value={draft.teacher} onChange={(event) => setDraft({ ...draft, teacher: event.target.value })} placeholder="教师待定" /></div>
        </div>
        {conflictMessage && <div className="form-reminder" role="status"><AlertTriangle /><span>{conflictMessage}</span></div>}
        <DialogFooter><Button type="submit"><CalendarClock />保存本周调整</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}

function BackupDialog({ open, onOpenChange, onExport, onImport }: { open: boolean; onOpenChange: (open: boolean) => void; onExport: () => void; onImport: () => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="backup-dialog" onOpenAutoFocus={(event) => event.preventDefault()}>
      <DialogHeader>
        <DialogTitle>数据备份与恢复</DialogTitle>
        <DialogDescription>备份包含课表、临时课程、备注以及调课和停课记录。</DialogDescription>
      </DialogHeader>
      <div className="backup-actions">
        <Button type="button" variant="outline" onClick={onExport}><Download /><span><strong>导出备份</strong><small>保存为一个 JSON 文件</small></span></Button>
        <Button type="button" variant="outline" onClick={onImport}><Upload /><span><strong>恢复备份</strong><small>从此前导出的文件恢复</small></span></Button>
      </div>
    </DialogContent>
  </Dialog>
}

function CourseDetailDialog({
  course,
  open,
  week,
  startsOn,
  onOpenChange,
  onSaveNote,
  onEdit,
  onAdjust,
  onCancel,
  onRestore,
  onDelete,
}: {
  course: Course | null
  open: boolean
  week: number
  startsOn: string
  onOpenChange: (open: boolean) => void
  onSaveNote: (id: string, note: string) => void
  onEdit: (id: string) => void
  onAdjust: (id: string) => void
  onCancel: (id: string) => void
  onRestore: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [note, setNote] = useState("")

  useEffect(() => {
    if (open) setNote(course?.note ?? "")
  }, [open, course?.id, course?.note])

  if (!course) return null
  const date = dateForWeekday(startsOn, week, course.day)
  const startSlot = timeSlots.find((slot) => slot.start === course.startSection)
  const endSlot = timeSlots.find((slot) => slot.end === course.endSection)
  const exactTime = startSlot && endSlot
    ? `${startSlot.time.split("–")[0]}–${endSlot.time.split("–")[1]}`
    : `第 ${course.startSection}–${course.endSection} 节`

  function save() {
    onSaveNote(course!.id, note)
    onOpenChange(false)
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="detail-dialog" onOpenAutoFocus={(event) => event.preventDefault()}>
      <DialogHeader>
        <div className={`detail-icon ${colors[course.color % colors.length]}`}>{course.custom ? <FlaskConical /> : <GraduationCap />}</div>
        <DialogTitle>{course.name}</DialogTitle>
        <DialogDescription>{course.custom ? "手动添加的临时课程" : course.cancelled ? `第 ${week} 周已停课` : course.adjusted ? `第 ${week} 周已临时调整` : (course.code || "课程详情")}</DialogDescription>
      </DialogHeader>
      {!course.custom && <div className={`adjustment-status ${course.cancelled ? "is-cancelled" : course.adjusted ? "is-adjusted" : ""}`}>
        <span>{course.cancelled ? "本周课程已停课" : course.adjusted ? "当前显示的是本周临时安排" : "本周如有变化，可单独调课或停课"}</span>
        <div>
          {course.cancelled ? <Button type="button" size="sm" variant="outline" onClick={() => onRestore(course.id)}><RotateCcw />恢复课程</Button> : <>
            <Button type="button" size="sm" variant="outline" onClick={() => onAdjust(course.id)}><CalendarClock />本周调课</Button>
            <Button type="button" size="sm" variant="outline" className="cancel-week-button" onClick={() => onCancel(course.id)}><Ban />本周停课</Button>
            {course.adjusted && <Button type="button" size="sm" variant="ghost" onClick={() => onRestore(course.id)}><RotateCcw />恢复原安排</Button>}
          </>}
        </div>
      </div>}
      <div className="detail-list">
        <div><CalendarDays /><span><small>日期与周次</small>{dayNames[course.day - 1]} · {date.getMonth() + 1}月{date.getDate()}日 · {compactWeeks(course.weeks)}</span></div>
        <div><Clock3 /><span><small>上课时间</small>第 {course.startSection}–{course.endSection} 节 · {exactTime}</span></div>
        <div><MapPin /><span><small>上课地点</small>{course.room}</span></div>
        <div><UserRound /><span><small>任课教师</small>{course.teachers.join("、") || "教师未获取"}</span></div>
      </div>
      <div className="note-field">
        <Label htmlFor="course-note"><NotebookPen />课程备注</Label>
        <Textarea id="course-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录实验分组、临时调课、作业提醒等" rows={4} />
        <small>备注只保存在这台设备上</small>
      </div>
      <DialogFooter className="detail-actions">
        {course.custom && <Button type="button" variant="destructive" onClick={() => { onDelete(course.id); onOpenChange(false) }}><Trash2 />删除课程</Button>}
        {course.custom && <Button type="button" variant="outline" onClick={() => onEdit(course.id)}><PencilLine />编辑课程</Button>}
        <Button type="button" onClick={save}><NotebookPen />保存备注</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

export default function ScheduleApp() {
  const [schedule, setSchedule] = useState<Schedule>(initialSchedule)
  const [hydrated, setHydrated] = useState(false)
  const [week, setWeek] = useState(() => currentWeek(initialSchedule.startsOn))
  const [selectedDay, setSelectedDay] = useState(() => dayOfWeek())
  const [view, setView] = useState<"day" | "week">("day")
  const [viewMotion, setViewMotion] = useState<"none" | "forward" | "backward">("none")
  const [now, setNow] = useState<Date | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addContext, setAddContext] = useState(() => ({ day: dayOfWeek(), slot: 1, fromBlank: false }))
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null)
  const [adjustingCourseId, setAdjustingCourseId] = useState<string | null>(null)
  const [backupOpen, setBackupOpen] = useState(false)
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)
  const [pendingRestore, setPendingRestore] = useState<Schedule | null>(null)
  const [androidAvailable, setAndroidAvailable] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const backupInput = useRef<HTMLInputElement>(null)
  const viewSwipeStart = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved) as Schedule
        setSchedule(parsed)
        setWeek(currentWeek(parsed.startsOn))
      }
    } catch { localStorage.removeItem(storageKey) }
    setHydrated(true)
    if (!window.TianyangAndroid && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined)
    }
    setAndroidAvailable(Boolean(window.TianyangAndroid?.openTeachingSystem))
  }, [])

  useEffect(() => {
    const receiveAndroidSchedule = (event: Event) => {
      const parsed = scheduleFromTeachingSystem((event as AndroidScheduleReadyEvent).detail)
      if (!parsed) {
        toast.error("教务系统返回的网页课表数据不完整")
        return
      }
      applyImportedSchedule(parsed)
    }
    window.addEventListener("tianyang:android-schedule-ready", receiveAndroidSchedule)
    return () => window.removeEventListener("tianyang:android-schedule-ready", receiveAndroidSchedule)
  })

  useEffect(() => {
    const update = () => setNow(new Date())
    update()
    const timer = window.setInterval(update, 30000)
    return () => window.clearInterval(timer)
  }, [])

  const weekCourses = useMemo(() => coursesForWeek(schedule.courses, week), [schedule.courses, week])
  const selectedDate = dateForWeekday(schedule.startsOn, week, selectedDay)
  const selectedCourses = useMemo(() => weekCourses.filter((course) => course.day === selectedDay && !course.cancelled), [weekCourses, selectedDay])
  const maxWeek = Math.max(26, ...schedule.courses.flatMap((course) => course.weeks))
  const selectedCourse = weekCourses.find((course) => course.id === selectedCourseId) ?? null
  const editingCourse = schedule.courses.find((course) => course.id === editingCourseId) ?? null
  const adjustingCourse = weekCourses.find((course) => course.id === adjustingCourseId) ?? null
  const todayWeek = now ? currentWeek(schedule.startsOn, now) : week
  const todayDay = now ? dayOfWeek(now) : selectedDay
  const status = now ? liveCourseStatus(schedule, now) : { kind: "loading", text: "正在读取今天课程…" }
  const awayFromToday = Boolean(now && (week !== todayWeek || selectedDay !== todayDay || view !== "day"))

  function saveSchedule(next: Schedule) {
    localStorage.setItem(storageKey, JSON.stringify(next))
    setSchedule(next)
  }

  function applyImportedSchedule(parsed: Schedule, toastId?: string | number) {
    const manualCourses = schedule.courses.filter((course) => course.custom)
    const previousById = new Map(schedule.courses.map((course) => [course.id, course]))
    const signature = (course: Course) => `${course.code ?? course.name}-${course.day}-${course.startSection}-${course.endSection}`
    const previousBySignature = new Map(schedule.courses.filter((course) => !course.custom).map((course) => [signature(course), course]))
    const importedCourses = parsed.courses.map((course) => {
      const previous = previousById.get(course.id) ?? previousBySignature.get(signature(course))
      return {
        ...course,
        teachers: course.teachers.length ? course.teachers : previous?.teachers ?? [],
        note: previous?.note,
        overrides: previous?.overrides,
      }
    })
    saveSchedule({ ...parsed, courses: [...importedCourses, ...manualCourses] })
    setWeek(currentWeek(parsed.startsOn))
    setSelectedDay(dayOfWeek())
    setView("day")
    toast.success(`成功更新 ${parsed.courses.length} 条上课安排`, toastId === undefined ? undefined : { id: toastId })
  }

  function addCourse(draft: DraftCourse) {
    const slot = timeSlots.find((item) => item.start === Number(draft.slot)) ?? timeSlots[0]
    const course: Course = {
      id: `manual-${Date.now()}`,
      name: draft.name.trim(),
      teachers: draft.teacher.split(/[、,，]/).map((teacher) => teacher.trim()).filter(Boolean),
      room: draft.room.trim() || "教室待定",
      day: Number(draft.day),
      startSection: slot.start,
      endSection: slot.end,
      weeks: draft.weeks,
      color: 5,
      custom: true,
    }
    saveSchedule({ ...schedule, courses: [...schedule.courses, course] })
    toast.success("临时课程已添加")
  }

  function updateCourse(draft: DraftCourse) {
    if (!editingCourse) return
    const slot = timeSlots.find((item) => item.start === Number(draft.slot)) ?? timeSlots[0]
    saveSchedule({
      ...schedule,
      courses: schedule.courses.map((course) => course.id === editingCourse.id ? {
        ...course,
        name: draft.name.trim(),
        teachers: draft.teacher.split(/[、,，]/).map((teacher) => teacher.trim()).filter(Boolean),
        room: draft.room.trim() || "教室待定",
        day: Number(draft.day),
        startSection: slot.start,
        endSection: slot.end,
        weeks: draft.weeks,
      } : course),
    })
    toast.success("临时课程已更新")
  }

  function openEditCourse(id: string) {
    setSelectedCourseId(null)
    setEditingCourseId(id)
  }

  function replaceOverride(courseId: string, override: CourseOverride | null) {
    saveSchedule({
      ...schedule,
      courses: schedule.courses.map((course) => {
        if (course.id !== courseId) return course
        const remaining = (course.overrides ?? []).filter((item) => item.week !== week)
        return { ...course, overrides: override ? [...remaining, override].sort((a, b) => a.week - b.week) : remaining }
      }),
    })
  }

  function saveAdjustment(draft: AdjustmentDraft) {
    if (!adjustingCourse) return
    const slot = timeSlots.find((item) => item.start === Number(draft.slot)) ?? timeSlots[0]
    replaceOverride(adjustingCourse.id, {
      id: `override-${adjustingCourse.id}-${week}`,
      week,
      day: Number(draft.day),
      startSection: slot.start,
      endSection: slot.end,
      room: draft.room.trim() || "教室待定",
      teachers: draft.teacher.split(/[、,，]/).map((teacher) => teacher.trim()).filter(Boolean),
    })
    toast.success(`第 ${week} 周课程已调整`)
  }

  function openAdjustment(id: string) {
    setSelectedCourseId(null)
    setAdjustingCourseId(id)
  }

  function cancelCourseForWeek(id: string) {
    replaceOverride(id, { id: `override-${id}-${week}`, week, cancelled: true })
    toast.success(`第 ${week} 周已标记停课`)
  }

  function restoreCourseForWeek(id: string) {
    replaceOverride(id, null)
    toast.success("已恢复原课程安排")
  }

  function exportBackup() {
    const payload: BackupEnvelope = { app: "tianyang-schedule", version: 1, exportedAt: new Date().toISOString(), schedule }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `天扬课表备份-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setBackupOpen(false)
    toast.success("备份文件已导出")
  }

  async function prepareRestore(file?: File) {
    if (!file) return
    try {
      const restored = scheduleFromBackup(JSON.parse(await file.text()) as unknown)
      if (!restored) throw new Error("这不是有效的天扬课表备份")
      setPendingRestore(restored)
      setBackupOpen(false)
      setRestoreConfirmOpen(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "备份文件读取失败")
    } finally {
      if (backupInput.current) backupInput.current.value = ""
    }
  }

  function confirmRestore() {
    if (!pendingRestore) return
    saveSchedule(pendingRestore)
    setWeek(currentWeek(pendingRestore.startsOn))
    setSelectedDay(dayOfWeek())
    setView("day")
    setSelectedCourseId(null)
    setPendingRestore(null)
    toast.success("课表数据已恢复")
  }

  function returnToToday() {
    const today = new Date()
    setWeek(currentWeek(schedule.startsOn, today))
    setSelectedDay(dayOfWeek(today))
    changeView("day")
  }

  function changeView(nextView: "day" | "week") {
    if (nextView === view) return
    setViewMotion(nextView === "week" ? "forward" : "backward")
    setView(nextView)
  }

  function startViewSwipe(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0]
    if (touch) viewSwipeStart.current = { x: touch.clientX, y: touch.clientY }
  }

  function finishViewSwipe(event: TouchEvent<HTMLDivElement>) {
    const start = viewSwipeStart.current
    const touch = event.changedTouches[0]
    viewSwipeStart.current = null
    if (!start || !touch) return
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < 52 || Math.abs(dx) <= Math.abs(dy) * 1.25) return
    changeView(dx < 0 ? "week" : "day")
  }

  function openAddCourse(day: number, slot = 1, fromBlank = false) {
    setAddContext({ day, slot, fromBlank })
    setAddOpen(true)
  }

  function deleteCourse(id: string) {
    saveSchedule({ ...schedule, courses: schedule.courses.filter((course) => course.id !== id) })
    toast.success("临时课程已删除")
  }

  function saveNote(id: string, note: string) {
    const cleanNote = note.trim()
    saveSchedule({ ...schedule, courses: schedule.courses.map((course) => course.id === id ? { ...course, note: cleanNote || undefined } : course) })
    toast.success(cleanNote ? "课程备注已保存" : "课程备注已清除")
  }

  async function importScheduleFile(file?: File) {
    if (!file) return
    const toastId = toast.loading(`正在读取 ${file.name}…`)
    try {
      const parsed = await parseScheduleFile(file)
      applyImportedSchedule(parsed, toastId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "课表识别失败", { id: toastId, duration: 6000 })
    } finally { if (fileInput.current) fileInput.current.value = "" }
  }

  return <main className="app-shell">
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <div className="app-frame">
      <header className="topbar">
        <div className="brand-mark"><GraduationCap /></div>
        <div className="brand-copy"><span>{schedule.term}</span><h1>我的课表</h1></div>
        <Button className="add-button" onClick={() => openAddCourse(selectedDay)}><Plus />实验课</Button>
      </header>

      <section className="week-hero">
        <div>
          <p className={`course-status ${status.kind}`} aria-live="polite">{status.text}</p>
          <h2>第 {week} 周</h2>
          <p className="week-range">{weekRange(schedule.startsOn, week)}</p>
        </div>
        <div className="week-switcher">
          <Button size="icon" variant="ghost" aria-label="上一周" disabled={week <= 1} onClick={() => setWeek((value) => Math.max(1, value - 1))}><ChevronLeft /></Button>
          <span>{week} / {maxWeek}</span>
          <Button size="icon" variant="ghost" aria-label="下一周" disabled={week >= maxWeek} onClick={() => setWeek((value) => Math.min(maxWeek, value + 1))}><ChevronRight /></Button>
        </div>
      </section>

      <div className="day-strip" role="tablist" aria-label="选择星期">
        {dayNames.map((name, index) => {
          const day = index + 1
          const date = dateForWeekday(schedule.startsOn, week, day)
          const hasCourse = weekCourses.some((course) => course.day === day)
          return <button key={name} role="tab" aria-selected={selectedDay === day} className={selectedDay === day ? "active" : ""} onClick={() => setSelectedDay(day)}><span>{name.slice(1)}</span><strong>{date.getDate()}</strong>{hasCourse && <i />}</button>
        })}
      </div>

      <Tabs value={view} onValueChange={(value) => changeView(value as "day" | "week")} className="schedule-tabs" data-motion={viewMotion} onTouchStart={startViewSwipe} onTouchEnd={finishViewSwipe} onTouchCancel={() => { viewSwipeStart.current = null }}>
        <div className="view-toolbar">
          <TabsList className="view-tabs"><TabsTrigger value="day"><Clock3 />单日</TabsTrigger><TabsTrigger value="week"><CalendarDays />周课表</TabsTrigger></TabsList>
          {awayFromToday && <Button type="button" size="sm" variant="ghost" className="today-button" onClick={returnToToday}><RotateCcw />回到今天</Button>}
        </div>
        <TabsContent value="day" className="schedule-view day-view">
          <div className="section-heading"><div><span>{dayNames[selectedDay - 1]}</span><h2>{selectedDate.getMonth() + 1}月{selectedDate.getDate()}日</h2></div><small>{selectedCourses.length} 门课</small></div>
          <div className="daily-timeline">
            {timeSlots.map((slot, index) => {
              const courses = coursesInSlot(weekCourses, selectedDay, slot.start, slot.end)
              const phaseChanged = index === 0 || timeSlots[index - 1].phase !== slot.phase
              return <section className={`time-row ${phaseChanged && index > 0 ? "phase-start" : ""}`} key={slot.start}>
                <div className="time-label"><span>{slot.phase}</span><strong>{slot.start}–{slot.end}节</strong><small>{slot.time}</small></div>
                <div className="time-content">{courses.length ? courses.map((course) => <CourseBar key={course.id} course={course} onOpen={() => setSelectedCourseId(course.id)} />) : <button type="button" className="empty-slot" onClick={() => openAddCourse(selectedDay, slot.start, true)} aria-label={`在${dayNames[selectedDay - 1]}第${slot.start}至${slot.end}节添加临时课程`}><Plus /><span>空闲 · 点击添加</span></button>}</div>
              </section>
            })}
          </div>
        </TabsContent>
        <TabsContent value="week" className="schedule-view week-view">
          <div className="timetable-wrap">
            <div className="timetable">
              {now && week === todayWeek && <div className="today-column-highlight" style={{ gridColumn: `${todayDay + 1} / ${todayDay + 2}`, gridRow: "1 / -1" }} aria-hidden="true" />}
              <div className="table-corner"><Clock3 /></div>
              {dayNames.map((name, index) => <div className="table-day" key={name}><span>{name}</span><strong>{dateForWeekday(schedule.startsOn, week, index + 1).getDate()}</strong></div>)}
              {timeSlots.map((slot, slotIndex) => [
                <div className={`table-time ${slotIndex > 0 && timeSlots[slotIndex - 1].phase !== slot.phase ? "phase-start" : ""}`} key={`time-${slot.start}`}><span>{slot.phase}</span><strong>{slot.start}–{slot.end}节</strong><small>{slot.time.split("–").map((time) => <b key={time}>{time}</b>)}</small></div>,
                ...dayNames.map((_, dayIndex) => {
                  const day = dayIndex + 1
                  const courses = coursesInSlot(weekCourses, day, slot.start, slot.end)
                  return <div className={`table-cell ${slotIndex > 0 && timeSlots[slotIndex - 1].phase !== slot.phase ? "phase-start" : ""}`} key={`${day}-${slot.start}`}>
                    {courses.length ? courses.map((course) => <CourseBar key={course.id} course={course} weekView onOpen={() => setSelectedCourseId(course.id)} />) : <button type="button" className="empty-cell" onClick={() => openAddCourse(day, slot.start, true)} aria-label={`在${dayNames[day - 1]}第${slot.start}至${slot.end}节添加临时课程`}><Plus /></button>}
                  </div>
                }),
              ])}
            </div>
          </div>
          <p className="scroll-hint">点击课程查看详情 · 点击空白格添加临时课程</p>
        </TabsContent>
      </Tabs>

      <footer>
        <span><ShieldCheck />课程与实验课只保存在这台设备上</span>
        <div className="footer-actions">
          <button onClick={() => setBackupOpen(true)}><DatabaseBackup />备份与恢复</button>
          {androidAvailable && <button onClick={() => window.TianyangAndroid?.openTeachingSystem()}><GraduationCap />教务系统读取</button>}
          <button onClick={() => fileInput.current?.click()}><FileUp />从文件导入</button>
        </div>
        <input ref={fileInput} className="sr-only" type="file" accept=".pdf,.xlsx,.xls,.csv,.tsv,.txt,.ics,.html,.htm,.json,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/calendar,application/json" onChange={(event) => importScheduleFile(event.target.files?.[0])} />
        <input ref={backupInput} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => prepareRestore(event.target.files?.[0])} />
      </footer>
      {!hydrated && <div className="loading-cover" />}
    </div>
    <CourseFormDialog open={addOpen} onOpenChange={setAddOpen} selectedWeek={week} selectedDay={addContext.day} selectedSlot={addContext.slot} totalWeeks={maxWeek} suppressAutoFocus={addContext.fromBlank} course={null} courses={schedule.courses} onSave={addCourse} />
    <CourseFormDialog open={Boolean(editingCourse)} onOpenChange={(isOpen) => { if (!isOpen) setEditingCourseId(null) }} selectedWeek={week} selectedDay={editingCourse?.day ?? selectedDay} selectedSlot={editingCourse?.startSection ?? 1} totalWeeks={maxWeek} suppressAutoFocus course={editingCourse} courses={schedule.courses} onSave={updateCourse} />
    <CourseAdjustmentDialog course={adjustingCourse} week={week} open={Boolean(adjustingCourse)} onOpenChange={(isOpen) => { if (!isOpen) setAdjustingCourseId(null) }} courses={schedule.courses} onSave={saveAdjustment} />
    <CourseDetailDialog course={selectedCourse} open={Boolean(selectedCourse)} week={week} startsOn={schedule.startsOn} onOpenChange={(isOpen) => { if (!isOpen) setSelectedCourseId(null) }} onSaveNote={saveNote} onEdit={openEditCourse} onAdjust={openAdjustment} onCancel={cancelCourseForWeek} onRestore={restoreCourseForWeek} onDelete={deleteCourse} />
    <BackupDialog open={backupOpen} onOpenChange={setBackupOpen} onExport={exportBackup} onImport={() => backupInput.current?.click()} />
    <AlertDialog open={restoreConfirmOpen} onOpenChange={setRestoreConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>恢复这份课表备份？</AlertDialogTitle><AlertDialogDescription>当前设备上的课表、临时课程、备注和调课记录会被备份内容替换。此操作无法撤销。</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel onClick={() => setPendingRestore(null)}>取消</AlertDialogCancel><AlertDialogAction onClick={confirmRestore}>确认恢复</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <Toaster position="top-center" richColors />
  </main>
}
