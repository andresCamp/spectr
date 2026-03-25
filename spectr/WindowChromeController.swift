//
//  WindowChromeController.swift
//  Spectr
//

import AppKit
import Combine

@MainActor
final class WindowChromeController: ObservableObject {
    @Published private(set) var isWindowHovered = false

    private weak var window: NSWindow?
    private var localMonitor: Any?
    private var globalMonitor: Any?
    private var notificationObservers: [NSObjectProtocol] = []

    func attach(to window: NSWindow?) {
        guard self.window !== window else { return }
        detach()
        self.window = window
        guard let window else { return }

        window.titlebarSeparatorStyle = .none

        setupMonitors()
        setupNotifications()

        let mouseLocation = NSEvent.mouseLocation
        let isInside = window.frame.contains(mouseLocation)
        applyHoverState(isInside, animated: false)
    }

    func detach() {
        if let monitor = localMonitor {
            NSEvent.removeMonitor(monitor)
            localMonitor = nil
        }
        if let monitor = globalMonitor {
            NSEvent.removeMonitor(monitor)
            globalMonitor = nil
        }
        for observer in notificationObservers {
            NotificationCenter.default.removeObserver(observer)
        }
        notificationObservers.removeAll()

        if let window {
            for buttonType: NSWindow.ButtonType in [.closeButton, .miniaturizeButton, .zoomButton] {
                window.standardWindowButton(buttonType)?.alphaValue = 1.0
            }
        }
        window = nil
    }

    // MARK: - Private

    private func setupMonitors() {
        localMonitor = NSEvent.addLocalMonitorForEvents(
            matching: [.mouseMoved, .mouseEntered, .mouseExited]
        ) { [weak self] event in
            self?.checkMouseLocation()
            return event
        }

        globalMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.mouseMoved, .mouseEntered, .mouseExited]
        ) { [weak self] _ in
            Task { @MainActor in
                self?.checkMouseLocation()
            }
        }
    }

    private func setupNotifications() {
        let resignKey = NotificationCenter.default.addObserver(
            forName: NSWindow.didResignKeyNotification,
            object: window,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.applyHoverState(false, animated: true)
            }
        }
        notificationObservers.append(resignKey)

        let becomeKey = NotificationCenter.default.addObserver(
            forName: NSWindow.didBecomeKeyNotification,
            object: window,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.checkMouseLocation()
            }
        }
        notificationObservers.append(becomeKey)
    }

    private func checkMouseLocation() {
        guard let window else { return }
        let mouseLocation = NSEvent.mouseLocation
        let isInside = window.frame.contains(mouseLocation)
        guard isInside != isWindowHovered else { return }
        applyHoverState(isInside, animated: true)
    }

    private func applyHoverState(_ hovered: Bool, animated: Bool) {
        isWindowHovered = hovered
        guard let window else { return }

        let targetAlpha: CGFloat = hovered ? 1.0 : 0.0
        let buttons: [NSWindow.ButtonType] = [.closeButton, .miniaturizeButton, .zoomButton]

        if animated {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.2
                for buttonType in buttons {
                    window.standardWindowButton(buttonType)?.animator().alphaValue = targetAlpha
                }
            }
        } else {
            for buttonType in buttons {
                window.standardWindowButton(buttonType)?.alphaValue = targetAlpha
            }
        }
    }
}
