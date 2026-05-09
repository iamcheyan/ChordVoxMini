import Cocoa
import Foundation
import Darwin

let mask = CGEventMask(
    (1 << CGEventType.flagsChanged.rawValue) |
    (1 << CGEventType.keyDown.rawValue) |
    (1 << CGEventType.keyUp.rawValue)
)
var fnIsDown = false
var eventTap: CFMachPort?
var lastModifierFlags: CGEventFlags = []

func eventTapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        return Unmanaged.passUnretained(event)
    }

    let flags = event.flags
    let keyCode = event.getIntegerValueField(.keyboardEventKeycode)

    if type == .flagsChanged {
        let containsFn = flags.contains(.maskSecondaryFn)

        if containsFn && !fnIsDown {
            fnIsDown = true
            FileHandle.standardOutput.write("FN_DOWN\n".data(using: .utf8)!)
            fflush(stdout)
        } else if !containsFn && fnIsDown {
            fnIsDown = false
            FileHandle.standardOutput.write("FN_UP\n".data(using: .utf8)!)
            fflush(stdout)
        }

        // Detect right-side modifier key down/up via keycode
        let rightModifiers: [(Int64, CGEventFlags, String)] = [
            (61, .maskAlternate, "RightOption"),
            (54, .maskCommand, "RightCommand"),
            (62, .maskControl, "RightControl"),
            (60, .maskShift, "RightShift"),
        ]
        for (code, flag, name) in rightModifiers {
            if keyCode == code {
                if flags.contains(flag) {
                    FileHandle.standardOutput.write("RIGHT_MOD_DOWN:\(name)\n".data(using: .utf8)!)
                } else {
                    FileHandle.standardOutput.write("RIGHT_MOD_UP:\(name)\n".data(using: .utf8)!)
                }
                fflush(stdout)
                break
            }
        }

        let modifierMask: CGEventFlags = [.maskControl, .maskCommand, .maskAlternate, .maskShift]
        let currentModifiers = flags.intersection(modifierMask)

        if currentModifiers != lastModifierFlags {
            let released = lastModifierFlags.subtracting(currentModifiers)
            let releases: [(CGEventFlags, String)] = [
                (.maskControl, "control"),
                (.maskCommand, "command"),
                (.maskAlternate, "option"),
                (.maskShift, "shift"),
            ]

            for (flag, name) in releases {
                if released.contains(flag) {
                    FileHandle.standardOutput.write("MODIFIER_UP:\(name)\n".data(using: .utf8)!)
                    fflush(stdout)
                }
            }

            lastModifierFlags = currentModifiers
        }
    } else if type == .keyDown || type == .keyUp {
        // JIS Keyboard keys (Kana and Eisu)
        // Keycode 102 is Eisu, 104 is Kana
        if keyCode == 102 {
            if type == .keyDown {
                FileHandle.standardOutput.write("JIS_EISU_DOWN\n".data(using: .utf8)!)
            } else {
                FileHandle.standardOutput.write("JIS_EISU_UP\n".data(using: .utf8)!)
            }
            fflush(stdout)
        } else if keyCode == 104 {
            if type == .keyDown {
                FileHandle.standardOutput.write("JIS_KANA_DOWN\n".data(using: .utf8)!)
            } else {
                FileHandle.standardOutput.write("JIS_KANA_UP\n".data(using: .utf8)!)
            }
            fflush(stdout)
        }
    }

    return Unmanaged.passUnretained(event)
}

guard let createdTap = CGEvent.tapCreate(tap: .cgSessionEventTap,
                                         place: .headInsertEventTap,
                                         options: .listenOnly,
                                         eventsOfInterest: mask,
                                         callback: eventTapCallback,
                                         userInfo: nil) else {
    FileHandle.standardError.write("Failed to create event tap\n".data(using: .utf8)!)
    exit(1)
}

eventTap = createdTap

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, createdTap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: createdTap, enable: true)

let signalSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
signal(SIGTERM, SIG_IGN)
signalSource.setEventHandler {
    CFRunLoopStop(CFRunLoopGetCurrent())
}
signalSource.resume()

CFRunLoopRun()
