//
//  ShortcutTooltip.swift
//  Spectr
//
//  Created by Andrés Campos on 3/23/26.
//

import AppKit
import SwiftUI

// MARK: - Tooltip data

struct ShortcutHint {
    let label: String
    let modifiers: [String]
    let key: String

    init(_ label: String, _ modifiers: [String] = ["⌘"], _ key: String) {
        self.label = label
        self.modifiers = modifiers
        self.key = key
    }

    init(_ label: String) {
        self.label = label
        self.modifiers = []
        self.key = ""
    }
}

// MARK: - Tooltip content

private struct TooltipContent: View {
    let hint: ShortcutHint

    var body: some View {
        HStack(spacing: 7) {
            Text(hint.label)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.primary.opacity(0.85))

            if !hint.key.isEmpty {
                HStack(spacing: 3) {
                    ForEach(hint.modifiers, id: \.self) { mod in
                        KeyBadge(text: mod)
                    }
                    KeyBadge(text: hint.key)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay {
            Capsule()
                .strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.5)
        }
        .shadow(color: .black.opacity(0.3), radius: 12, y: 4)
    }
}

private struct KeyBadge: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold, design: .rounded))
            .foregroundStyle(.primary.opacity(0.5))
            .frame(minWidth: 20, minHeight: 18)
            .padding(.horizontal, 3)
            .background(.primary.opacity(0.08), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
    }
}

// MARK: - Floating tooltip panel

private final class TooltipPanel: NSPanel {
    init() {
        super.init(
            contentRect: .zero,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: true
        )
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = .floating
        ignoresMouseEvents = true
        isReleasedWhenClosed = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

// MARK: - Tooltip controller

@MainActor
private final class TooltipController {
    static let shared = TooltipController()

    private var panel: TooltipPanel?
    private var hostingView: NSHostingView<AnyView>?
    private var showTimer: Timer?
    private var currentOwner: AnyHashable?

    func show(hint: ShortcutHint, sourceView: NSView, owner: AnyHashable, delay: TimeInterval) {
        if currentOwner != owner {
            hideNow()
        }
        currentOwner = owner

        showTimer?.invalidate()
        showTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            DispatchQueue.main.async {
                self?.present(hint: hint, sourceView: sourceView)
            }
        }
    }

    func hide(owner: AnyHashable?) {
        if let owner, currentOwner != owner { return }
        showTimer?.invalidate()
        showTimer = nil
        currentOwner = nil
        hideNow()
    }

    private func hideNow() {
        panel?.orderOut(nil)
    }

    private func present(hint: ShortcutHint, sourceView: NSView) {
        guard let window = sourceView.window else { return }

        let panel = getOrCreatePanel()

        // Create a fresh hosting view each time to get correct sizing
        let content = TooltipContent(hint: hint).fixedSize()
        let hv = NSHostingView(rootView: AnyView(content))
        hv.sizingOptions = [.intrinsicContentSize]
        panel.contentView = hv
        self.hostingView = hv

        hv.layoutSubtreeIfNeeded()
        let size = hv.intrinsicContentSize

        // Get source view's frame in screen coordinates
        let viewFrameInWindow = sourceView.convert(sourceView.bounds, to: nil)
        let viewFrameOnScreen = window.convertToScreen(viewFrameInWindow)

        let screenFrame = sourceView.window?.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero
        let padding: CGFloat = 8

        // Vertical: above if room, otherwise below
        let tooltipTopY = viewFrameOnScreen.maxY + 6 + size.height
        let fitsAbove = tooltipTopY <= screenFrame.maxY
        let y = fitsAbove
            ? viewFrameOnScreen.maxY + 6
            : viewFrameOnScreen.minY - size.height - 6

        // Horizontal: centered, clamped to screen edges
        let centeredX = viewFrameOnScreen.midX - size.width / 2
        let x = min(max(centeredX, screenFrame.minX + padding), screenFrame.maxX - size.width - padding)

        panel.setFrame(CGRect(x: x, y: y, width: size.width, height: size.height), display: true)
        panel.orderFrontRegardless()
    }

    private func getOrCreatePanel() -> TooltipPanel {
        if let panel { return panel }
        let p = TooltipPanel()
        self.panel = p
        return p
    }
}

// MARK: - Transparent tracking view (passes clicks through, receives hover)

private final class TooltipTrackingView: NSView {
    var onHoverChange: ((Bool, NSView) -> Void)?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach { removeTrackingArea($0) }
        addTrackingArea(NSTrackingArea(
            rect: bounds,
            options: [.mouseEnteredAndExited, .activeInActiveApp, .inVisibleRect],
            owner: self,
            userInfo: nil
        ))
    }

    // Pass all clicks through to views beneath
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func mouseEntered(with event: NSEvent) {
        onHoverChange?(true, self)
    }

    override func mouseExited(with event: NSEvent) {
        onHoverChange?(false, self)
    }
}

private struct TooltipTrackingRepresentable: NSViewRepresentable {
    let hint: ShortcutHint
    let delay: TimeInterval
    let ownerID: UUID

    func makeNSView(context: Context) -> TooltipTrackingView {
        let view = TooltipTrackingView()
        configureHover(view)
        return view
    }

    func updateNSView(_ nsView: TooltipTrackingView, context: Context) {
        configureHover(nsView)
    }

    private func configureHover(_ view: TooltipTrackingView) {
        view.onHoverChange = { hovering, nsView in
            if hovering {
                TooltipController.shared.show(
                    hint: hint,
                    sourceView: nsView,
                    owner: ownerID,
                    delay: delay
                )
            } else {
                TooltipController.shared.hide(owner: ownerID)
            }
        }
    }
}

// MARK: - View modifier

private struct ShortcutTooltipModifier: ViewModifier {
    let hint: ShortcutHint
    let delay: TimeInterval

    @State private var ownerID = UUID()

    func body(content: Content) -> some View {
        content
            .overlay {
                TooltipTrackingRepresentable(hint: hint, delay: delay, ownerID: ownerID)
            }
    }
}

extension View {
    func shortcutTooltip(
        _ hint: ShortcutHint,
        delay: TimeInterval = 0.4
    ) -> some View {
        modifier(ShortcutTooltipModifier(hint: hint, delay: delay))
    }
}
