//
//  KeyboardShortcutsOverlay.swift
//  Spectr
//
//  Created by Andrés Campos on 3/23/26.
//

import SwiftUI

// MARK: - Shortcut Data

private struct ShortcutEntry: Identifiable {
    let id = UUID()
    let modifiers: String   // e.g. "" or "⇧"
    let key: String          // e.g. "N", "+", "0"
    let label: String
}

private struct ShortcutGroup: Identifiable {
    let id = UUID()
    let title: String
    let shortcuts: [ShortcutEntry]
}

private let shortcutGroups: [ShortcutGroup] = [
    ShortcutGroup(title: "File", shortcuts: [
        ShortcutEntry(modifiers: "", key: "N", label: "New Document"),
        ShortcutEntry(modifiers: "\u{21E7}", key: "N", label: "Welcome Window"),
        ShortcutEntry(modifiers: "", key: "O", label: "Open File"),
        ShortcutEntry(modifiers: "", key: "P", label: "Quick Open"),
        ShortcutEntry(modifiers: "", key: "S", label: "Save"),
    ]),
    ShortcutGroup(title: "Edit", shortcuts: [
        ShortcutEntry(modifiers: "", key: "B", label: "Bold"),
        ShortcutEntry(modifiers: "", key: "I", label: "Italic"),
        ShortcutEntry(modifiers: "", key: "E", label: "Inline Code"),
    ]),
    ShortcutGroup(title: "View", shortcuts: [
        ShortcutEntry(modifiers: "", key: "R", label: "Toggle Rendered/Raw"),
        ShortcutEntry(modifiers: "\u{21E7}", key: "P", label: "Pin Window on Top"),
        ShortcutEntry(modifiers: "\u{21E7}", key: "M", label: "Toggle Reader Margins"),
        ShortcutEntry(modifiers: "", key: "+", label: "Increase Text Size"),
        ShortcutEntry(modifiers: "", key: "\u{2212}", label: "Decrease Text Size"),
        ShortcutEntry(modifiers: "", key: "0", label: "Reset Text Size"),
    ]),
]

// MARK: - Command Hold Monitor

@MainActor
@Observable
final class CommandHoldMonitor {
    var isShowingShortcuts = false

    private nonisolated(unsafe) var localMonitor: Any?
    private nonisolated(unsafe) var keyDownMonitor: Any?
    private var holdTimer: Timer?
    private let holdDelay: TimeInterval = 0.6
    /// Set when a chord (Cmd+key) fires; suppresses the guide until Cmd is fully released.
    private var chordUsed = false

    init() {
        localMonitor = NSEvent.addLocalMonitorForEvents(
            matching: .flagsChanged
        ) { [weak self] event in
            DispatchQueue.main.async {
                self?.handleFlags(event)
            }
            return event
        }

        keyDownMonitor = NSEvent.addLocalMonitorForEvents(
            matching: .keyDown
        ) { [weak self] event in
            DispatchQueue.main.async {
                self?.handleKeyDown(event)
            }
            return event
        }
    }

    func tearDown() {
        if let monitor = localMonitor {
            NSEvent.removeMonitor(monitor)
            localMonitor = nil
        }
        if let monitor = keyDownMonitor {
            NSEvent.removeMonitor(monitor)
            keyDownMonitor = nil
        }
        holdTimer?.invalidate()
    }

    private func handleKeyDown(_ event: NSEvent) {
        if event.modifierFlags.contains(.command) {
            chordUsed = true
            holdTimer?.invalidate()
            holdTimer = nil
            if isShowingShortcuts {
                isShowingShortcuts = false
            }
        }
    }

    private func handleFlags(_ event: NSEvent) {
        let commandOnly = event.modifierFlags.contains(.command)
            && !event.modifierFlags.contains(.shift)
            && !event.modifierFlags.contains(.option)
            && !event.modifierFlags.contains(.control)
        let noModifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask).isEmpty

        if noModifiers {
            // All modifiers released — reset chord state
            chordUsed = false
            holdTimer?.invalidate()
            holdTimer = nil
            if isShowingShortcuts {
                isShowingShortcuts = false
            }
        } else if commandOnly && !chordUsed {
            holdTimer?.invalidate()
            holdTimer = Timer.scheduledTimer(withTimeInterval: holdDelay, repeats: false) { [weak self] _ in
                DispatchQueue.main.async {
                    self?.isShowingShortcuts = true
                }
            }
        } else {
            holdTimer?.invalidate()
            holdTimer = nil
            if isShowingShortcuts {
                isShowingShortcuts = false
            }
        }
    }
}

// MARK: - Overlay View

struct KeyboardShortcutsOverlay: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Keyboard Shortcuts")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.primary.opacity(0.5))

            HStack(alignment: .top, spacing: 32) {
                ForEach(shortcutGroups) { group in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(group.title)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.primary.opacity(0.4))
                            .textCase(.uppercase)
                            .tracking(0.5)
                            .padding(.leading, 9)

                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(group.shortcuts) { shortcut in
                                HStack(spacing: 0) {
                                    // Extra modifiers (⇧ etc.) right-aligned before ⌘
                                    Text(shortcut.modifiers)
                                        .font(.system(size: 12, weight: .medium, design: .rounded))
                                        .foregroundStyle(Color.primary.opacity(0.45))
                                        .frame(width: 16, alignment: .trailing)

                                    // ⌘ + key, left-aligned
                                    Text("\u{2318}\(shortcut.key)")
                                        .font(.system(size: 12, weight: .medium, design: .rounded))
                                        .foregroundStyle(Color.primary.opacity(0.7))
                                        .frame(width: 30, alignment: .leading)

                                    Text(shortcut.label)
                                        .font(.system(size: 12))
                                        .foregroundStyle(Color.primary.opacity(0.55))
                                        .padding(.leading, 8)
                                }
                            }
                        }
                    }
                }
            }
        }
        .padding(24)
        .background {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(colorScheme == .dark
                    ? AnyShapeStyle(.ultraThinMaterial)
                    : AnyShapeStyle(Color(white: 0.97)))
                .shadow(
                    color: .black.opacity(colorScheme == .dark ? 0.25 : 0.14),
                    radius: colorScheme == .dark ? 30 : 24,
                    y: 10
                )
        }
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(
                    colorScheme == .dark
                        ? Color.white.opacity(0.1)
                        : Color.black.opacity(0.08),
                    lineWidth: 0.5
                )
        }
    }
}

// MARK: - View Modifier

struct CommandHoldShortcutsModifier: ViewModifier {
    @State private var monitor = CommandHoldMonitor()
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .overlay {
                if monitor.isShowingShortcuts {
                    ZStack {
                        Color.black.opacity(colorScheme == .dark ? 0.2 : 0.12)
                            .ignoresSafeArea()

                        KeyboardShortcutsOverlay()
                    }
                    .transition(.opacity.animation(.easeOut(duration: 0.15)))
                    .allowsHitTesting(false)
                }
            }
            .animation(.easeOut(duration: 0.15), value: monitor.isShowingShortcuts)
            .onDisappear {
                monitor.tearDown()
            }
    }
}

extension View {
    func commandHoldShortcuts() -> some View {
        modifier(CommandHoldShortcutsModifier())
    }
}
