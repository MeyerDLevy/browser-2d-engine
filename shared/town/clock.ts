import { MINUTES_PER_REAL_SECOND, NIGHT_SHIFT_END, NIGHT_SHIFT_START, SERVICE_HOUR, WEEKDAY_NAMES } from './config.ts'

export type ClockState = {
  day: number
  hour: number
  minute: number
  speed: number
  minutesPerRealSecond: number
  accum: number
}

export function makeClock(): ClockState {
  return { day: 1, hour: 7, minute: 0, speed: 1, minutesPerRealSecond: MINUTES_PER_REAL_SECOND, accum: 0 }
}

export function weekday(c: ClockState) {
  return (c.day - 1) % 7
}

export function weekdayName(c: ClockState) {
  return WEEKDAY_NAMES[weekday(c)]
}

export function timeString(c: ClockState) {
  const hh = String(c.hour).padStart(2, '0')
  const mm = String(c.minute).padStart(2, '0')
  return `Day ${c.day} (${weekdayName(c)})  ${hh}:${mm}`
}

export function isSunday(c: ClockState) {
  return weekday(c) === 0
}

export function isServiceHour(c: ClockState) {
  return isSunday(c) && c.hour === SERVICE_HOUR
}

export function isWorkHours(c: ClockState) {
  return c.hour >= 9 && c.hour < 17
}

export function isNightShift(c: ClockState) {
  return c.hour >= NIGHT_SHIFT_START || c.hour < NIGHT_SHIFT_END
}

export function isDayShift(c: ClockState) {
  return !isNightShift(c)
}

export function isNight(c: ClockState) {
  return c.hour >= 22 || c.hour < 6
}

export function tickMinute(c: ClockState) {
  c.minute += 1
  let hourPassed = false
  let dayPassed = false
  if (c.minute >= 60) {
    c.minute = 0
    c.hour += 1
    hourPassed = true
    if (c.hour >= 24) {
      c.hour = 0
      c.day += 1
      dayPassed = true
    }
  }
  return { hourPassed, dayPassed }
}
