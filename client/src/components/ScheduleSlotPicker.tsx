import { useEffect, useMemo, useState } from "preact/hooks";
import { api } from "../lib/api";

const EASTERN_TIME_ZONE = "America/New_York";
const DAY_COUNT = 7;

interface Props {
  enabled: boolean;
  selectedStart: string;
  selectedEnd: string;
  refreshKey?: number;
  onSelect: (selection: { startIso: string; endIso: string; hasPendingConflict: boolean }) => void;
}

interface ScheduleSlot {
  submission_id: string;
  title: string;
  status: string;
  starts_at: string;
  ends_at: string;
}

interface SlotOccupancy {
  status: "available" | "pending" | "blocked";
  titles: string[];
}

interface EasternParts {
  year: number;
  month: number;
  day: number;
  hour: number;
}

const partFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
});

const labelFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
});

const timeLabelFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const offsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_TIME_ZONE,
  timeZoneName: "shortOffset",
  hour: "2-digit",
});

function getEasternParts(date: Date): EasternParts {
  const map = new Map(
    partFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number(map.get("year")),
    month: Number(map.get("month")),
    day: Number(map.get("day")),
    hour: Number(map.get("hour")),
  };
}

function getEasternOffsetMinutes(utcDate: Date) {
  const zoneName = offsetFormatter
    .formatToParts(utcDate)
    .find((part) => part.type === "timeZoneName")?.value ?? "GMT-5";

  const match = zoneName.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) {
    return -300;
  }

  const [, sign, hours, minutes] = match;
  const totalMinutes = Number(hours) * 60 + Number(minutes ?? "0");
  return sign === "-" ? -totalMinutes : totalMinutes;
}

function easternWallTimeToUtcIso(year: number, month: number, day: number, hour: number) {
  let utcGuess = Date.UTC(year, month - 1, day, hour, 0, 0, 0);

  for (let index = 0; index < 3; index += 1) {
    const offsetMinutes = getEasternOffsetMinutes(new Date(utcGuess));
    utcGuess = Date.UTC(year, month - 1, day, hour, 0, 0, 0) - offsetMinutes * 60_000;
  }

  return new Date(utcGuess).toISOString();
}

function addUtcHour(isoString: string) {
  return new Date(new Date(isoString).getTime() + 60 * 60 * 1000).toISOString();
}

function dayKey(parts: Pick<EasternParts, "year" | "month" | "day">) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function slotKey(parts: EasternParts) {
  return `${dayKey(parts)}-${String(parts.hour).padStart(2, "0")}`;
}

function buildDayParts() {
  const todayEastern = getEasternParts(new Date());
  return Array.from({ length: DAY_COUNT }, (_, index) => {
    const base = new Date(Date.UTC(todayEastern.year, todayEastern.month - 1, todayEastern.day + index));
    return {
      year: base.getUTCFullYear(),
      month: base.getUTCMonth() + 1,
      day: base.getUTCDate(),
    };
  });
}

function buildOccupancy(slots: ScheduleSlot[]) {
  const occupancy = new Map<string, SlotOccupancy>();

  for (const slot of slots) {
    let cursor = new Date(slot.starts_at).getTime();
    const end = new Date(slot.ends_at).getTime();

    while (cursor < end) {
      const key = slotKey(getEasternParts(new Date(cursor)));
      const existing = occupancy.get(key);
      const nextStatus =
        slot.status === "pending"
          ? "pending"
          : slot.status === "approved" || slot.status === "scheduled"
            ? "blocked"
            : "available";

      if (!existing) {
        occupancy.set(key, { status: nextStatus, titles: [slot.title] });
      } else if (existing.status !== "blocked") {
        occupancy.set(key, {
          status: nextStatus === "blocked" ? "blocked" : existing.status === "pending" ? "pending" : nextStatus,
          titles: [...existing.titles, slot.title],
        });
      } else {
        existing.titles.push(slot.title);
      }

      cursor += 60 * 60 * 1000;
    }
  }

  return occupancy;
}

export function ScheduleSlotPicker({ enabled, selectedStart, selectedEnd, refreshKey = 0, onSelect }: Props) {
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [status, setStatus] = useState("Loading schedule...");
  const dayParts = useMemo(() => buildDayParts(), []);
  const occupancy = useMemo(() => buildOccupancy(slots), [slots]);

  useEffect(() => {
    setStatus("Loading schedule...");
    api.publicSchedule()
      .then((data) => {
        setSlots(data.slots);
        setStatus("ET schedule view");
      })
      .catch((error) => setStatus(error.message));
  }, [refreshKey]);

  const selectedKey = selectedStart ? slotKey(getEasternParts(new Date(selectedStart))) : "";

  return (
    <div className="schedule-picker">
      <div className="schedule-picker__header">
        <div>
          <h3>Pick A 1-Hour ET Slot</h3>
          <p className="small">
            Approved and scheduled slots are unavailable. Pending slots are selectable,
            but first come first serve and a pending request may still be accepted first.
          </p>
        </div>
        <div className="small">{status}</div>
      </div>

      <div className="schedule-grid">
        <div className="schedule-grid__time-column">
          <div className="schedule-grid__corner" />
          {Array.from({ length: 24 }, (_, hour) => (
            <div key={hour} className="schedule-grid__time-label">
              {timeLabelFormatter.format(new Date(Date.UTC(2026, 0, 1, hour)))}
            </div>
          ))}
        </div>

        {dayParts.map((day) => (
          <div key={dayKey(day)} className="schedule-grid__day-column">
            <div className="schedule-grid__day-label">
              {labelFormatter.format(new Date(Date.UTC(day.year, day.month - 1, day.day, 12)))}
            </div>
            {Array.from({ length: 24 }, (_, hour) => {
              const key = `${dayKey(day)}-${String(hour).padStart(2, "0")}`;
              const entry = occupancy.get(key);
              const startIso = easternWallTimeToUtcIso(day.year, day.month, day.day, hour);
              const endIso = addUtcHour(startIso);
              const isBlocked = entry?.status === "blocked";
              const isPending = entry?.status === "pending";
              const isSelected = selectedKey === key && selectedEnd === endIso;

              return (
                <button
                  key={key}
                  type="button"
                  className={`schedule-slot${isBlocked ? " schedule-slot--blocked" : ""}${isPending ? " schedule-slot--pending" : ""}${isSelected ? " schedule-slot--selected" : ""}`}
                  disabled={!enabled || isBlocked}
                  title={entry?.titles.join(", ") ?? "Available"}
                  onClick={() => onSelect({ startIso, endIso, hasPendingConflict: isPending })}
                >
                  {isBlocked ? "Taken" : isPending ? "Pending" : "Open"}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {selectedStart ? (
        <div className="schedule-picker__selection small">
          Selected ET slot: {timeLabelFormatter.format(new Date(selectedStart))} on{" "}
          {labelFormatter.format(new Date(selectedStart))}
        </div>
      ) : null}
    </div>
  );
}
