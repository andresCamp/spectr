//
//  DocumentView.swift
//  Specter
//
//  Created by Andrés Campos on 3/18/26.
//

import AppKit
import SwiftUI

enum ViewMode: String {
    case rendered
    case raw

    var iconName: String {
        switch self {
        case .rendered:
            return "doc.plaintext"
        case .raw:
            return "doc.richtext"
        }
    }

    var helpText: String {
        switch self {
        case .rendered:
            return "Show Raw Markdown"
        case .raw:
            return "Show Rendered"
        }
    }

    var toggled: ViewMode {
        switch self {
        case .rendered:
            return .raw
        case .raw:
            return .rendered
        }
    }
}

struct DocumentView: View {
    let fileURL: URL?
    @Binding var document: SpecterDocument
    @State private var viewMode: ViewMode = .rendered
    @State private var isPinned = false
    @State private var usesReaderWidth = false
    @State private var textScale: CGFloat = EditorTextScale.defaultValue
    @State private var pinchZoomScale: CGFloat = 1.0
    @State private var currentWindow: NSWindow?
    @State private var editorZoomController = EditorZoomController()
    @StateObject private var fileSyncController = DocumentFileSyncController()
    @State private var windowPinController = WindowPinController()
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            AmbientWindowBackground(colorScheme: colorScheme)

            EditorWebView(
                text: $document.text,
                mode: viewMode,
                colorScheme: colorScheme,
                zoomController: editorZoomController,
                textScale: textScale,
                usesReaderWidth: usesReaderWidth
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .containerBackground(
            Material.thin.materialActiveAppearance(.active),
            for: .window
        )
        .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
        .background(
            WindowAccessorView { window in
                currentWindow = window
                fileSyncController.configure(
                    window: window,
                    fileURL: fileURL,
                    text: $document.text
                )
                windowPinController.attach(to: window)
            }
        )
        .overlay(alignment: .top) {
            TitleBarFadeOverlay(colorScheme: colorScheme)
        }
        .overlay(alignment: .bottomTrailing) {
            Group {
                if isZoomed {
                    ZoomResetBadge(scale: pinchZoomScale) {
                        editorZoomController.resetZoom()
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                } else if viewMode == .rendered {
                    MarginsToggle(isEnabled: $usesReaderWidth)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .padding(.trailing, 18)
            .padding(.bottom, 18)
        }
        .focusedSceneValue(
            \.editorTextSizeActions,
            EditorTextSizeActions(
                increase: increaseTextSize,
                decrease: decreaseTextSize,
                reset: resetTextSize
            )
        )
        .onAppear {
            editorZoomController.onMagnificationChanged = { scale in
                pinchZoomScale = scale
            }
            fileSyncController.configure(
                window: currentWindow,
                fileURL: fileURL,
                text: $document.text
            )
        }
        .onDisappear {
            editorZoomController.onMagnificationChanged = nil
            fileSyncController.disconnect()
        }
        .onChange(of: fileURL) { _, newValue in
            fileSyncController.configure(
                window: currentWindow,
                fileURL: newValue,
                text: $document.text
            )
        }
        .onChange(of: isPinned) { _, newValue in
            windowPinController.setPinned(newValue)
        }
        .alert("File Changed on Disk", isPresented: conflictAlertIsPresented) {
            Button("Reload from Disk", role: .destructive) {
                fileSyncController.reloadFromDisk()
            }
            Button("Keep Local Changes", role: .cancel) {
                fileSyncController.keepLocalChanges()
            }
        } message: {
            Text("Another process changed this file on disk. Reload to discard Specter’s current in-memory edits, or keep working with the local version.")
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                HStack(spacing: 2) {
                    GhostToolbarIconButton(
                        systemName: isPinned ? "pin.fill" : "pin",
                        helpText: isPinned ? "Unpin Window" : "Pin Window on Top",
                        isActive: isPinned
                    ) {
                        isPinned.toggle()
                    }

                    GhostToolbarIconButton(
                        systemName: viewMode.iconName,
                        helpText: viewMode.helpText
                    ) {
                        viewMode = viewMode.toggled
                    }
                }
            }
            .sharedBackgroundVisibility(.hidden)
        }
        .animation(.spring(response: 0.24, dampingFraction: 0.86), value: isZoomed)
        .animation(.spring(response: 0.24, dampingFraction: 0.86), value: viewMode)
    }

    private var isZoomed: Bool {
        pinchZoomScale > 1.001
    }

    private func increaseTextSize() {
        textScale = EditorTextScale.clamped(textScale + EditorTextScale.step)
    }

    private func decreaseTextSize() {
        textScale = EditorTextScale.clamped(textScale - EditorTextScale.step)
    }

    private func resetTextSize() {
        textScale = EditorTextScale.defaultValue
    }

    private var conflictAlertIsPresented: Binding<Bool> {
        Binding(
            get: { fileSyncController.conflict != nil },
            set: { isPresented in
                if !isPresented {
                    fileSyncController.keepLocalChanges()
                }
            }
        )
    }
}

private struct GhostToolbarIconButton: View {
    var systemName: String
    var helpText: String
    var isActive = false
    var action: () -> Void

    @State private var isHovered = false
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 13, weight: .semibold))
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.primary.opacity(iconOpacity))
        .onHover { hovering in
            isHovered = hovering
        }
        .help(helpText)
        .accessibilityLabel(helpText)
        .animation(.easeOut(duration: 0.12), value: isHovered)
    }

    private var iconOpacity: Double {
        if isHovered {
            return 0.97
        }

        if isActive {
            return 0.92
        }

        return 0.72
    }
}

private struct ZoomResetBadge: View {
    var scale: CGFloat
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .strokeBorder(Color.primary.opacity(0.18), lineWidth: 1)
                        .frame(width: 28, height: 22)

                    RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                        .fill(Color.primary.opacity(0.18))
                        .frame(
                            width: max(8, 28 / scale),
                            height: max(6, 22 / scale)
                        )
                }

                Text("\(Int((scale * 100).rounded()))%")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .monospacedDigit()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(.thinMaterial, in: Capsule())
            .overlay {
                Capsule()
                    .strokeBorder(Color.white.opacity(0.12), lineWidth: 0.5)
            }
        }
        .buttonStyle(.plain)
        .help("Reset Pinch Zoom")
    }
}

private struct MarginsToggle: View {
    @Binding var isEnabled: Bool

    var body: some View {
        Button {
            isEnabled.toggle()
        } label: {
            Image(systemName: isEnabled ? "arrow.left.and.line.vertical.and.arrow.right" : "arrow.right.and.line.vertical.and.arrow.left")
                .font(.system(size: 12, weight: .semibold))
                .padding(9)
                .background(.thinMaterial, in: Circle())
                .overlay {
                    Circle()
                        .strokeBorder(Color.white.opacity(0.12), lineWidth: 0.5)
                }
        }
        .buttonStyle(.plain)
        .help(isEnabled ? "Use Wide Margins" : "Use Narrow Margins")
    }
}

private struct AmbientWindowBackground: View {
    var colorScheme: ColorScheme

    var body: some View {
        ZStack {
            Rectangle()
                .fill(baseTint)

            LinearGradient(
                colors: topGlowColors,
                startPoint: .top,
                endPoint: .bottom
            )

            LinearGradient(
                colors: diagonalWashColors,
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            LinearGradient(
                colors: [
                    Color.white.opacity(colorScheme == .dark ? 0.04 : 0.16),
                    .clear,
                    Color.black.opacity(colorScheme == .dark ? 0.08 : 0.03),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .ignoresSafeArea()
    }

    private var baseTint: Color {
        switch colorScheme {
        case .dark:
            return Color(red: 0.14, green: 0.11, blue: 0.10).opacity(0.56)
        default:
            return Color(red: 0.96, green: 0.94, blue: 0.92).opacity(0.62)
        }
    }

    private var topGlowColors: [Color] {
        switch colorScheme {
        case .dark:
            return [
                Color(red: 0.27, green: 0.20, blue: 0.17).opacity(0.18),
                Color.clear,
                Color.black.opacity(0.06),
            ]
        default:
            return [
                Color.white.opacity(0.35),
                Color.clear,
                Color(red: 0.84, green: 0.80, blue: 0.76).opacity(0.10),
            ]
        }
    }

    private var diagonalWashColors: [Color] {
        switch colorScheme {
        case .dark:
            return [
                Color(red: 0.22, green: 0.17, blue: 0.15).opacity(0.10),
                Color(red: 0.16, green: 0.14, blue: 0.13).opacity(0.04),
                Color.black.opacity(0.02),
            ]
        default:
            return [
                Color.white.opacity(0.16),
                Color(red: 0.95, green: 0.91, blue: 0.87).opacity(0.07),
                Color(red: 0.90, green: 0.88, blue: 0.84).opacity(0.03),
            ]
        }
    }
}

private struct TitleBarFadeOverlay: View {
    var colorScheme: ColorScheme

    var body: some View {
        ZStack {
            NativeTitleBarBlurView(colorScheme: colorScheme)

            LinearGradient(
                colors: tintColors,
                startPoint: .top,
                endPoint: .bottom
            )
            .mask {
                fadeMask
            }
        }
            .frame(height: 144)
            .ignoresSafeArea(edges: .top)
            .allowsHitTesting(false)
    }

    private var fadeMask: LinearGradient {
        LinearGradient(
            stops: [
                .init(color: .black, location: 0.0),
                .init(color: .black.opacity(0.92), location: 0.22),
                .init(color: .black.opacity(0.56), location: 0.54),
                .init(color: .black.opacity(0.14), location: 0.86),
                .init(color: .clear, location: 1.0),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private var tintColors: [Color] {
        switch colorScheme {
        case .dark:
            return [
                Color(red: 0.24, green: 0.19, blue: 0.17).opacity(0.20),
                Color(red: 0.17, green: 0.13, blue: 0.12).opacity(0.08),
                .clear,
            ]
        default:
            return [
                Color.white.opacity(0.26),
                Color(red: 0.93, green: 0.90, blue: 0.86).opacity(0.10),
                .clear,
            ]
        }
    }
}

private struct NativeTitleBarBlurView: NSViewRepresentable {
    var colorScheme: ColorScheme

    func makeNSView(context: Context) -> MaskedTitleBarBlurView {
        let view = MaskedTitleBarBlurView()
        view.material = material
        return view
    }

    func updateNSView(_ nsView: MaskedTitleBarBlurView, context: Context) {
        nsView.material = material
        nsView.updateMask()
    }

    private var material: NSVisualEffectView.Material {
        switch colorScheme {
        case .dark:
            return .hudWindow
        default:
            return .titlebar
        }
    }
}

private final class MaskedTitleBarBlurView: NSVisualEffectView {
    private let fadeStops: [(location: CGFloat, opacity: CGFloat)] = [
        (0.0, 1.0),
        (0.22, 0.92),
        (0.54, 0.56),
        (0.86, 0.14),
        (1.0, 0.0),
    ]

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        blendingMode = .withinWindow
        state = .active
        isEmphasized = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layout() {
        super.layout()
        updateMask()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        state = window == nil ? .inactive : .active
        updateMask()
    }

    func updateMask() {
        guard bounds.width > 0, bounds.height > 0 else { return }
        maskImage = Self.makeMaskImage(size: bounds.size, stops: fadeStops)
    }

    private static func makeMaskImage(
        size: CGSize,
        stops: [(location: CGFloat, opacity: CGFloat)]
    ) -> NSImage {
        let image = NSImage(size: size)
        image.lockFocus()

        guard
            let context = NSGraphicsContext.current?.cgContext,
            let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
            let gradient = CGGradient(
                colorsSpace: colorSpace,
                colors: stops.map { NSColor.white.withAlphaComponent($0.opacity).cgColor } as CFArray,
                locations: stops.map(\.location)
            )
        else {
            image.unlockFocus()
            return image
        }

        let start = CGPoint(x: 0, y: size.height)
        let end = CGPoint(x: 0, y: 0)
        context.drawLinearGradient(gradient, start: start, end: end, options: [])

        image.unlockFocus()
        return image
    }
}
