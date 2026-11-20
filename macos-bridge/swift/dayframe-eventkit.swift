import EventKit
import Foundation

struct RequestPayload: Decodable {
    let action: String?
    let startMs: Double?
    let endMs: Double?
    let title: String?
    let notes: String?
    let location: String?
    let calendarId: String?
    let eventId: String?
    let alarmMinutesBefore: Double?
}

func emitJson(_ dict: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    } else {
        print("{\"ok\":false,\"error\":\"Failed serializing EventKit response\"}")
    }
}

func containsVideoUrl(_ text: String) -> Bool {
    let lower = text.lowercased()
    let markers = [
        "zoom.us/",
        "meet.google.com/",
        "teams.microsoft.com/",
        "teams.live.com/",
        "webex.com/",
        "chime.aws/",
        "around.co/",
        "tuple.app/",
        "whereby.com/"
    ]
    for m in markers {
        if lower.contains(m) { return true }
    }
    return false
}

let stdinData = FileHandle.standardInput.readDataToEndOfFile()
let payload = (try? JSONDecoder().decode(RequestPayload.self, from: stdinData)) ?? RequestPayload(
    action: "scan",
    startMs: nil,
    endMs: nil,
    title: nil,
    notes: nil,
    location: nil,
    calendarId: nil,
    eventId: nil,
    alarmMinutesBefore: nil
)

let store = EKEventStore()
let currentStatus = EKEventStore.authorizationStatus(for: .event)
var granted = false
var authErrText = ""

if #available(macOS 14.0, *) {
    if currentStatus == .fullAccess {
        granted = true
    } else if currentStatus == .notDetermined {
        let sem = DispatchSemaphore(value: 0)
        store.requestFullAccessToEvents { ok, err in
            granted = ok
            if let err = err {
                authErrText = err.localizedDescription
            }
            sem.signal()
        }
        _ = sem.wait(timeout: .now() + 20.0)
    }
} else {
    if currentStatus == .authorized {
        granted = true
    } else if currentStatus == .notDetermined {
        let sem = DispatchSemaphore(value: 0)
        store.requestAccess(to: .event) { ok, err in
            granted = ok
            if let err = err {
                authErrText = err.localizedDescription
            }
            sem.signal()
        }
        _ = sem.wait(timeout: .now() + 20.0)
    }
}

let finalStatus = EKEventStore.authorizationStatus(for: .event)
if #available(macOS 14.0, *) {
    if finalStatus == .fullAccess {
        granted = true
    }
} else if finalStatus == .authorized {
    granted = true
}

if !granted {
    emitJson([
        "ok": false,
        "authStatus": finalStatus.rawValue,
        "authError": authErrText,
        "error": "EventKit authorization status=\(finalStatus.rawValue)"
    ])
    exit(0)
}

let action = payload.action ?? "scan"

if action == "update" {
    guard let id = payload.eventId, !id.isEmpty,
          let ev = store.event(withIdentifier: id) else {
        emitJson(["ok": false, "error": "Calendar event was not found."])
        exit(0)
    }
    guard ev.calendar?.allowsContentModifications == true else {
        emitJson(["ok": false, "error": "Calendar event is read-only."])
        exit(0)
    }
    if let newTitle = payload.title, !newTitle.isEmpty {
        ev.title = newTitle
    }
    if let notes = payload.notes {
        ev.notes = notes
    }
    if let alarmMins = payload.alarmMinutesBefore, alarmMins >= 0 {
        ev.addAlarm(EKAlarm(relativeOffset: -alarmMins * 60.0))
    }
    do {
        try store.save(ev, span: .thisEvent, commit: true)
        emitJson(["ok": true])
    } catch {
        emitJson(["ok": false, "error": error.localizedDescription])
    }
    exit(0)
}

if action == "delete" {
    guard let id = payload.eventId, !id.isEmpty,
          let ev = store.event(withIdentifier: id) else {
        emitJson(["ok": false, "error": "Calendar event was not found."])
        exit(0)
    }
    do {
        try store.remove(ev, span: .thisEvent, commit: true)
        emitJson(["ok": true])
    } catch {
        emitJson(["ok": false, "error": error.localizedDescription])
    }
    exit(0)
}

if action == "create" {
    let startSec = (payload.startMs ?? 0) / 1000.0
    let endSec = (payload.endMs ?? 0) / 1000.0
    if endSec <= startSec || startSec <= 0 {
        emitJson(["ok": false, "error": "Invalid event start/end timestamps."])
        exit(0)
    }

    guard let cid = payload.calendarId, !cid.isEmpty,
          let cal = store.calendar(withIdentifier: cid),
          cal.allowsContentModifications else {
        emitJson([
            "ok": false,
            "error": "Refusing to write. Dayframe only writes to the personal UMich calendar, and that calendar was not found."
        ])
        exit(0)
    }

    let ev = EKEvent(eventStore: store)
    ev.title = payload.title ?? "Scheduled Block"
    ev.startDate = Date(timeIntervalSince1970: startSec)
    ev.endDate = Date(timeIntervalSince1970: endSec)
    if let notes = payload.notes, !notes.isEmpty {
        ev.notes = notes
    }
    if let loc = payload.location, !loc.isEmpty {
        ev.location = loc
    }
    ev.calendar = cal

    do {
        try store.save(ev, span: .thisEvent, commit: true)
        emitJson([
            "ok": true,
            "externalEventId": ev.eventIdentifier ?? "",
            "calendarTitle": cal.title
        ])
    } catch {
        emitJson([
            "ok": false,
            "error": "Failed saving event to macOS Calendar: \(error.localizedDescription)"
        ])
    }
    exit(0)
}

// Default action: "scan" with FULL meeting context (attendees, organizer, notes, URLs, calendar mutability)
let defaultCalId = store.defaultCalendarForNewEvents?.calendarIdentifier ?? ""
let cals = store.calendars(for: .event).map { c -> [String: Any] in
    return [
        "id": c.calendarIdentifier,
        "title": c.title,
        "sourceTitle": c.source?.title ?? "Mac",
        "allowsModify": c.allowsContentModifications,
        "isDefault": c.calendarIdentifier == defaultCalId
    ]
}

let nowMs = Date().timeIntervalSince1970 * 1000.0
let startMs = payload.startMs ?? nowMs
let endMs = payload.endMs ?? (startMs + 7.0 * 24.0 * 60.0 * 60.0 * 1000.0)
let startDate = Date(timeIntervalSince1970: startMs / 1000.0)
let endDate = Date(timeIntervalSince1970: endMs / 1000.0)

let pred = store.predicateForEvents(withStart: startDate, end: endDate, calendars: nil)
let rawEvents = store.events(matching: pred)
let iso = ISO8601DateFormatter()
iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

var outEvents: [[String: Any]] = []
for (idx, ev) in rawEvents.enumerated() {
    if ev.isAllDay { continue }
    let title = ev.title ?? "Untitled Event"
    let rawNotes = ev.notes ?? ""
    let notesTrimmed = String(rawNotes.prefix(900))
    let locationStr = ev.location ?? ""
    let urlStr = ev.url?.absoluteString ?? ""

    var attendeeNames: [String] = []
    var humanAttendeeCount = 0
    if let attendees = ev.attendees {
        for p in attendees {
            // Skip room resources (participantType == .room is 2)
            if p.participantType == .room || p.participantType == .resource {
                continue
            }
            humanAttendeeCount += 1
            if attendeeNames.count < 8 {
                let rawName = p.name ?? p.url.absoluteString.replacingOccurrences(of: "mailto:", with: "")
                if !rawName.isEmpty {
                    attendeeNames.append(rawName)
                }
            }
        }
    }

    let organizerName = ev.organizer?.name ?? ""
    let hasVideoLink = !urlStr.isEmpty || containsVideoUrl(locationStr) || containsVideoUrl(rawNotes)
    let isDayframeCreated =
        title.hasPrefix("[Prep] ") ||
        title.hasPrefix("[Focus] ") ||
        title.hasPrefix("[Solo Hold] ") ||
        rawNotes.contains("Scheduled offline by Dayframe") ||
        rawNotes.contains("Scheduled by Dayframe")

    outEvents.append([
        "id": ev.eventIdentifier ?? "ek-\(idx)",
        "title": title,
        "startIso": iso.string(from: ev.startDate),
        "endIso": iso.string(from: ev.endDate),
        "isRecurring": ev.hasRecurrenceRules,
        "location": locationStr,
        "url": urlStr,
        "hasVideoLink": hasVideoLink,
        "notes": notesTrimmed,
        "attendeeCount": humanAttendeeCount,
        "attendeeNames": attendeeNames,
        "organizerName": organizerName,
        "calendarId": ev.calendar?.calendarIdentifier ?? "",
        "calendarTitle": ev.calendar?.title ?? "Calendar",
        "calendarImmutable": !(ev.calendar?.allowsContentModifications ?? true),
        "isDayframeCreated": isDayframeCreated
    ])
}

emitJson([
    "ok": true,
    "backend": "swift-eventkit",
    "defaultCalendarId": defaultCalId,
    "calendars": cals,
    "events": outEvents
])
