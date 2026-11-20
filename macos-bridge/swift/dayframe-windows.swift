import CoreGraphics
import Foundation

let privateApps: Set<String> = [
    "1Password",
    "Keychain Access",
    "Bitwarden",
    "Passwords",
    "LastPass",
    "ScreenSaverEngine",
    "loginwindow"
]

let browsers: Set<String> = [
    "Google Chrome",
    "Arc",
    "Safari",
    "Brave Browser",
    "Firefox",
    "Microsoft Edge",
    "Orion",
    "Zen",
    "Zen Browser",
    "Vivaldi",
    "Dia"
]

let emailApps: Set<String> = [
    "Mail",
    "Microsoft Outlook",
    "Mimestream",
    "Superhuman",
    "Spark",
    "Spark Desktop",
    "Thunderbird",
    "Canary Mail",
    "Notion Mail"
]

let collabApps: Set<String> = [
    "Microsoft Teams",
    "Messages",
    "Linear",
    "Notion",
    "Discord",
    "WhatsApp"
]

func classifyWindow(owner: String, title: String) -> (kind: String, priority: Int)? {
    if privateApps.contains(owner) { return nil }
    let lowerTitle = title.lowercased()
    if lowerTitle.contains("dayframe") { return nil }

    if owner == "Slack" {
        return ("slack", 1)
    }

    if browsers.contains(owner) {
        if lowerTitle.contains("slack") {
            return ("slack", 1)
        }
        if lowerTitle.contains("gmail") ||
           lowerTitle.contains("inbox") ||
           lowerTitle.contains("outlook") ||
           lowerTitle.contains("proton mail") ||
           lowerTitle.contains("fastmail") ||
           lowerTitle.contains("mail - ") {
            return ("email", 2)
        }
        if lowerTitle.contains("linear") || lowerTitle.contains("notion") || lowerTitle.contains("github") {
            return ("work-context", 4)
        }
        return nil
    }

    if emailApps.contains(owner) {
        return ("email", 2)
    }

    if collabApps.contains(owner) {
        return ("messaging", 3)
    }

    return nil
}

let opts: CGWindowListOption = [.optionAll, .excludeDesktopElements]
guard let rawList = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
    print("{\"ok\":true,\"windows\":[]}")
    exit(0)
}

var candidates: [[String: Any]] = []
var seenOwnersKinds = Set<String>()

for win in rawList {
    let layer = (win[kCGWindowLayer as String] as? Int) ?? 99
    if layer != 0 { continue }

    let alpha = (win[kCGWindowAlpha as String] as? Double) ?? 1.0
    if alpha < 0.1 { continue }

    guard let bounds = win[kCGWindowBounds as String] as? [String: Any],
          let w = bounds["Width"] as? Double,
          let h = bounds["Height"] as? Double,
          w >= 360, h >= 260 else {
        continue
    }

    guard let winId = win[kCGWindowNumber as String] as? Int,
          let owner = win[kCGWindowOwnerName as String] as? String else {
        continue
    }

    let title = (win[kCGWindowName as String] as? String) ?? ""
    let isOnScreen = (win[kCGWindowIsOnscreen as String] as? Bool) ?? false

    guard let (kind, priority) = classifyWindow(owner: owner, title: title) else {
        continue
    }

    let dedupeKey = "\(owner)::\(kind)::\(title)"
    if seenOwnersKinds.contains(dedupeKey) { continue }
    seenOwnersKinds.insert(dedupeKey)

    candidates.append([
        "windowId": winId,
        "ownerName": owner,
        "windowTitle": title.isEmpty ? owner : title,
        "kind": kind,
        "priority": priority + (isOnScreen ? 0 : 1),
        "isOnScreen": isOnScreen,
        "area": Int(w * h)
    ])
}

candidates.sort { a, b in
    let pa = (a["priority"] as? Int) ?? 99
    let pb = (b["priority"] as? Int) ?? 99
    if pa != pb { return pa < pb }
    let aa = (a["area"] as? Int) ?? 0
    let ab = (b["area"] as? Int) ?? 0
    return aa > ab
}

let topWindows = Array(candidates.prefix(5))
if let data = try? JSONSerialization.data(withJSONObject: ["ok": true, "windows": topWindows], options: []),
   let str = String(data: data, encoding: .utf8) {
    print(str)
} else {
    print("{\"ok\":true,\"windows\":[]}")
}
