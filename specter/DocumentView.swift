//
//  DocumentView.swift
//  Specter
//
//  Created by Andrés Campos on 3/18/26.
//

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
    @Binding var document: SpecterDocument
    @State private var viewMode: ViewMode = .rendered
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            AmbientWindowBackground(colorScheme: colorScheme)

            EditorWebView(
                text: $document.text,
                mode: viewMode,
                colorScheme: colorScheme
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    viewMode = viewMode.toggled
                } label: {
                    Image(systemName: viewMode.iconName)
                }
                .help(viewMode.helpText)
            }
        }
    }
}

private struct AmbientWindowBackground: View {
    var colorScheme: ColorScheme

    var body: some View {
        ZStack {
            WindowBlurView(material: colorScheme == .dark ? .hudWindow : .sidebar)

            Rectangle()
                .fill(baseTint)

            LinearGradient(
                colors: topGlowColors,
                startPoint: .top,
                endPoint: .bottom
            )

            RadialGradient(
                colors: accentGlowColors,
                center: .bottomTrailing,
                startRadius: 40,
                endRadius: 360
            )
            .blendMode(.screen)

            LinearGradient(
                colors: [
                    Color.white.opacity(colorScheme == .dark ? 0.08 : 0.2),
                    .clear,
                    Color.black.opacity(colorScheme == .dark ? 0.18 : 0.05),
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
            return Color(red: 0.13, green: 0.11, blue: 0.10).opacity(0.78)
        default:
            return Color(red: 0.96, green: 0.94, blue: 0.92).opacity(0.76)
        }
    }

    private var topGlowColors: [Color] {
        switch colorScheme {
        case .dark:
            return [
                Color(red: 0.26, green: 0.20, blue: 0.17).opacity(0.34),
                Color.clear,
                Color.black.opacity(0.18),
            ]
        default:
            return [
                Color.white.opacity(0.55),
                Color.clear,
                Color(red: 0.84, green: 0.80, blue: 0.76).opacity(0.18),
            ]
        }
    }

    private var accentGlowColors: [Color] {
        switch colorScheme {
        case .dark:
            return [
                Color(red: 0.36, green: 0.38, blue: 0.48).opacity(0.16),
                Color(red: 0.18, green: 0.16, blue: 0.14).opacity(0.05),
                .clear,
            ]
        default:
            return [
                Color(red: 0.70, green: 0.77, blue: 0.92).opacity(0.18),
                Color(red: 0.97, green: 0.92, blue: 0.88).opacity(0.08),
                .clear,
            ]
        }
    }
}

private struct WindowBlurView: NSViewRepresentable {
    var material: NSVisualEffectView.Material

    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.blendingMode = .behindWindow
        view.state = .active
        view.material = material
        return view
    }

    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.state = .active
    }
}
