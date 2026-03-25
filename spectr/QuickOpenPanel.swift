//
//  QuickOpenPanel.swift
//  Spectr
//
//  Created by Andrés Campos on 3/23/26.
//

import AppKit
import SwiftUI

// MARK: - Project root detection

enum ProjectRootFinder {
    private static let markers: [String] = [".git", ".gitignore", ".github"]
    private static let maxDepth = 20

    static func find(from fileURL: URL?) -> URL? {
        guard let fileURL else { return nil }
        var dir = fileURL.deletingLastPathComponent()
        let fs = FileManager.default

        for _ in 0..<maxDepth {
            for marker in markers {
                let candidate = dir.appendingPathComponent(marker)
                var isDir: ObjCBool = false
                if fs.fileExists(atPath: candidate.path(percentEncoded: false), isDirectory: &isDir) {
                    return dir
                }
            }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { break }
            dir = parent
        }

        // Fallback: file's own directory
        return fileURL.deletingLastPathComponent()
    }
}

// MARK: - File entry model

struct ProjectFileEntry: Identifiable {
    let id: URL
    let url: URL
    let name: String          // filename without .md
    let relativePath: String  // path from project root
    let directoryPath: String // directory portion of relativePath
    let proximity: Int        // directory distance to current file
    let contentHash: UInt32   // FNV-1a hash for fingerprint
    let characterCount: Int
}

// MARK: - File scanner

enum ProjectFileScanner {
    private static let ignoredDirectories: Set<String> = [
        "node_modules", ".build", "build", "dist", "DerivedData",
        ".swiftpm", "Pods", "vendor", ".venv", "venv", "__pycache__",
        ".next", ".nuxt", ".output", "target", ".gradle",
    ]

    static func scan(root: URL, currentFileURL: URL?) -> [ProjectFileEntry] {
        let fs = FileManager.default
        let rootPath = root.path(percentEncoded: false)
        let currentDir = currentFileURL?.deletingLastPathComponent()
            .path(percentEncoded: false) ?? rootPath

        guard let enumerator = fs.enumerator(
            at: root,
            includingPropertiesForKeys: [.isRegularFileKey, .isDirectoryKey],
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        ) else {
            return []
        }

        var entries: [ProjectFileEntry] = []

        for case let fileURL as URL in enumerator {
            // Skip ignored directories
            if let isDir = try? fileURL.resourceValues(forKeys: [.isDirectoryKey]).isDirectory,
               isDir, ignoredDirectories.contains(fileURL.lastPathComponent) {
                enumerator.skipDescendants()
                continue
            }
            guard fileURL.pathExtension.lowercased() == "md" else { continue }
            guard let values = try? fileURL.resourceValues(
                forKeys: [.isRegularFileKey]
            ), values.isRegularFile == true else { continue }

            let filePath = fileURL.path(percentEncoded: false)
            let relativePath = String(filePath.dropFirst(rootPath.count))
                .trimmingCharacters(in: CharacterSet(charactersIn: "/"))

            let name = fileURL.deletingPathExtension().lastPathComponent
            let directoryPath: String = {
                let dir = (relativePath as NSString).deletingLastPathComponent
                return dir == "." ? "" : dir
            }()

            // Read content for hash + character count
            let content = (try? String(contentsOf: fileURL, encoding: .utf8)) ?? ""
            let hash = fnv1aHash(content)
            let charCount = content.count

            let fileDir = fileURL.deletingLastPathComponent().path(percentEncoded: false)
            let proximity = directoryDistance(from: currentDir, to: fileDir, root: rootPath)

            entries.append(ProjectFileEntry(
                id: fileURL,
                url: fileURL,
                name: name,
                relativePath: relativePath,
                directoryPath: directoryPath,
                proximity: proximity,
                contentHash: hash,
                characterCount: charCount
            ))
        }

        // Sort by proximity, then alphabetically
        entries.sort {
            if $0.proximity != $1.proximity { return $0.proximity < $1.proximity }
            return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }

        return entries
    }

    private static func directoryDistance(from a: String, to b: String, root: String) -> Int {
        let rootComponents = root.split(separator: "/")
        let aComponents = Array(a.split(separator: "/").dropFirst(rootComponents.count))
        let bComponents = Array(b.split(separator: "/").dropFirst(rootComponents.count))

        var shared = 0
        for i in 0..<min(aComponents.count, bComponents.count) {
            if aComponents[i] == bComponents[i] { shared += 1 }
            else { break }
        }

        return (aComponents.count - shared) + (bComponents.count - shared)
    }
}

// MARK: - FNV-1a hash (matching editor.js)

private func fnv1aHash(_ str: String) -> UInt32 {
    var h: UInt32 = 0x811c9dc5
    for scalar in str.unicodeScalars {
        h ^= UInt32(scalar.value & 0xFFFF)
        h = h &* 0x01000193
    }
    return h
}

// MARK: - Mulberry32 PRNG (matching editor.js)

private struct Mulberry32 {
    private var seed: Int32

    init(seed: UInt32) {
        self.seed = Int32(bitPattern: seed)
    }

    mutating func next() -> Double {
        seed = seed &+ 0x6d2b79f5
        var t = Int64(seed) &* Int64(1 | seed ^ (Int32(bitPattern: UInt32(bitPattern: seed) >> 15)))
        t = Int64(Int32(truncatingIfNeeded: t))
        let t32 = Int32(truncatingIfNeeded: t)
        let u = t32 &+ Int32(truncatingIfNeeded: Int64(t32) &* Int64(61 | t32 ^ (Int32(bitPattern: UInt32(bitPattern: t32) >> 7))))
        let result = UInt32(bitPattern: u ^ Int32(bitPattern: UInt32(bitPattern: u) >> 14))
        return Double(result) / 4294967296.0
    }
}

// MARK: - Fingerprint card view

private struct FingerprintCanvas: View {
    let contentHash: UInt32
    let trimColor: Color
    let colorScheme: ColorScheme

    private var neutralTile: Color {
        colorScheme == .dark ? .white : .black
    }

    var body: some View {
        Canvas { context, size in
            let w = size.width
            let h = size.height
            guard w > 0, h > 0 else { return }

            var rng = Mulberry32(seed: contentHash)

            let tileSize: CGFloat = 8
            let gap: CGFloat = 1.5
            let step = tileSize + gap
            let cols = Int(ceil(w / step))
            let rows = Int(ceil(h / step))

            let isDark = colorScheme == .dark
            let trimRange = isDark ? (lo: 0.08, hi: 0.22) : (lo: 0.14, hi: 0.32)
            let neutralRange = isDark ? (lo: 0.04, hi: 0.09) : (lo: 0.06, hi: 0.14)

            for row in 0..<rows {
                for col in 0..<cols {
                    let v = rng.next()
                    if v < 0.35 { continue }

                    let x = CGFloat(col) * step
                    let y = CGFloat(row) * step
                    let rect = CGRect(x: x, y: y, width: tileSize, height: tileSize)

                    if v < 0.65 {
                        let opacity = trimRange.lo + rng.next() * trimRange.hi
                        context.fill(Path(rect), with: .color(trimColor.opacity(opacity)))
                    } else {
                        let opacity = neutralRange.lo + rng.next() * neutralRange.hi
                        context.fill(Path(rect), with: .color(neutralTile.opacity(opacity)))
                    }
                }
            }

        }
    }
}

// MARK: - Quick open panel

struct QuickOpenPanel: View {
    let fileURL: URL?
    let currentWindow: NSWindow?
    let dismiss: () -> Void

    private enum InputMode { case mouse, keyboard }

    @State private var query = ""
    @State private var entries: [ProjectFileEntry] = []
    @State private var selectedIndex: Int?
    @State private var inputMode: InputMode = .mouse
    @FocusState private var isSearchFocused: Bool
    @Environment(\.openDocument) private var openDocument
    @Environment(\.colorScheme) private var colorScheme

    private var trimColor: Color {
        colorScheme == .dark
            ? Color(red: 0.89, green: 0.74, blue: 0.59)   // #e3bd96
            : Color(red: 0.85, green: 0.70, blue: 0.29)    // #d9b24a
    }

    private var filtered: [ProjectFileEntry] {
        if query.isEmpty { return entries }
        let q = query.lowercased()
        return entries.filter {
            $0.name.lowercased().contains(q) ||
            $0.relativePath.lowercased().contains(q)
        }
    }

    private var groupedEntries: [(directory: String, entries: [ProjectFileEntry])] {
        let grouped = Dictionary(grouping: filtered, by: \.directoryPath)
        return grouped
            .sorted { a, b in
                let aMin = a.value.map(\.proximity).min() ?? .max
                let bMin = b.value.map(\.proximity).min() ?? .max
                if aMin != bMin { return aMin < bMin }
                return a.key.localizedCaseInsensitiveCompare(b.key) == .orderedAscending
            }
            .map { (directory: $0.key, entries: $0.value) }
    }

    private let columns = [
        GridItem(.adaptive(minimum: 180, maximum: 240), spacing: 12)
    ]

    var body: some View {
        ZStack {
            // Backdrop
            Color.black.opacity(colorScheme == .dark ? 0.35 : 0.20)
                .ignoresSafeArea()
                .onTapGesture { dismiss() }

            VStack(spacing: 0) {
                // Search field
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.secondary)

                    TextField("Search .md files…", text: $query)
                        .textFieldStyle(.plain)
                        .font(.system(size: 15))
                        .focused($isSearchFocused)
                        .onSubmit {
                            if let idx = selectedIndex, idx < filtered.count {
                                openEntry(filtered[idx])
                            } else if let first = filtered.first {
                                openEntry(first)
                            }
                        }
                        .onChange(of: query) { _, _ in
                            selectedIndex = nil
                        }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)

                Divider().opacity(0.4)

                // Card grid
                if groupedEntries.isEmpty {
                    VStack(spacing: 8) {
                        Spacer()
                        Text("No notes found")
                            .font(.system(size: 14))
                            .foregroundStyle(.secondary)
                        Spacer()
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    ScrollViewReader { proxy in
                        ScrollView {
                            VStack(alignment: .leading, spacing: 20) {
                                let flat = filtered
                                ForEach(groupedEntries, id: \.directory) { group in
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text(group.directory.isEmpty ? "root" : group.directory)
                                            .font(.system(size: 11, weight: .medium))
                                            .foregroundStyle(.secondary)
                                            .padding(.horizontal, 4)

                                        LazyVGrid(columns: columns, spacing: 12) {
                                            ForEach(group.entries) { entry in
                                                let flatIndex = flat.firstIndex(where: { $0.id == entry.id })
                                                QuickOpenCard(
                                                    entry: entry,
                                                    isCurrentFile: entry.url == fileURL,
                                                    isSelected: inputMode == .keyboard && flatIndex == selectedIndex,
                                                    showHover: inputMode == .mouse,
                                                    trimColor: trimColor,
                                                    colorScheme: colorScheme
                                                ) {
                                                    openEntry(entry)
                                                } onHover: { hovering in
                                                    if hovering {
                                                        inputMode = .mouse
                                                        selectedIndex = flatIndex
                                                    }
                                                }
                                                .id(entry.id)
                                            }
                                        }
                                    }
                                }
                            }
                            .padding(16)
                        }
                        .onChange(of: selectedIndex) { _, newIndex in
                            if inputMode == .keyboard,
                               let newIndex, newIndex < filtered.count {
                                withAnimation(.easeOut(duration: 0.1)) {
                                    proxy.scrollTo(filtered[newIndex].id, anchor: .center)
                                }
                            }
                        }
                    }
                }
            }
            .frame(width: 520, height: 440)
            .background {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(colorScheme == .dark
                        ? AnyShapeStyle(.ultraThinMaterial)
                        : AnyShapeStyle(Color(white: 0.97)))
            }
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(
                        colorScheme == .dark
                            ? Color.white.opacity(0.12)
                            : Color.black.opacity(0.08),
                        lineWidth: 0.5
                    )
            }
            .shadow(
                color: .black.opacity(colorScheme == .dark ? 0.35 : 0.18),
                radius: colorScheme == .dark ? 40 : 30,
                y: 12
            )
        }
        .onAppear {
            isSearchFocused = true
            loadEntries()
        }
        .onExitCommand { dismiss() }
        .onKeyPress(.upArrow) { moveSelection(-columnsPerRow); return .handled }
        .onKeyPress(.downArrow) { moveSelection(columnsPerRow); return .handled }
        .onKeyPress(.leftArrow) { moveSelection(-1); return .handled }
        .onKeyPress(.rightArrow) { moveSelection(1); return .handled }
    }

    // Adaptive grid: 180–240pt cards in a 520 - 32 (padding) = 488pt area → 2 columns
    private var columnsPerRow: Int {
        let available: CGFloat = 520 - 32
        let minWidth: CGFloat = 180
        let spacing: CGFloat = 12
        return max(1, Int((available + spacing) / (minWidth + spacing)))
    }

    private func moveSelection(_ delta: Int) {
        let count = filtered.count
        guard count > 0 else { return }
        inputMode = .keyboard
        if let current = selectedIndex {
            let next = current + delta
            selectedIndex = max(0, min(count - 1, next))
        } else {
            selectedIndex = delta > 0 ? 0 : count - 1
        }
    }

    private func loadEntries() {
        guard let root = ProjectRootFinder.find(from: fileURL) else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            let scanned = ProjectFileScanner.scan(root: root, currentFileURL: fileURL)
            DispatchQueue.main.async {
                entries = scanned
            }
        }
    }

    private func openEntry(_ entry: ProjectFileEntry) {
        dismiss()
        if entry.url == fileURL { return }
        let windowToClose = currentWindow
        let savedFrame = windowToClose?.frame
        Task {
            do {
                try await openDocument(at: entry.url)
                if let savedFrame, let newWindow = NSApp.keyWindow, newWindow !== windowToClose {
                    newWindow.setFrame(savedFrame, display: true)
                }
                windowToClose?.close()
            } catch {
                NSSound.beep()
            }
        }
    }
}

// MARK: - Card

private struct QuickOpenCard: View {
    let entry: ProjectFileEntry
    let isCurrentFile: Bool
    var isSelected: Bool = false
    var showHover: Bool = true
    let trimColor: Color
    let colorScheme: ColorScheme
    let action: () -> Void
    var onHover: ((Bool) -> Void)?

    @State private var isHovered = false

    private var isHighlighted: Bool { isSelected || (showHover && isHovered) }

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 0) {
                // Mosaic
                FingerprintCanvas(contentHash: entry.contentHash, trimColor: trimColor, colorScheme: colorScheme)
                    .frame(height: 72)
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .padding(.horizontal, 10)
                    .padding(.top, 10)

                // Info
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(entry.name)
                            .font(.system(size: 13, weight: .semibold))
                            .lineLimit(1)

                        if isCurrentFile {
                            Circle()
                                .fill(trimColor)
                                .frame(width: 6, height: 6)
                        }
                    }

                    Text(entry.directoryPath.isEmpty ? (isCurrentFile ? "Current" : "Root") : entry.directoryPath)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .padding(.bottom, 11)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .background(cardBackground, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                if isHighlighted {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(
                            colorScheme == .dark
                                ? Color.white.opacity(0.14)
                                : Color.black.opacity(0.10),
                            lineWidth: 0.5
                        )
                }
            }
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            isHovered = hovering
            onHover?(hovering)
        }
        .scaleEffect(isHighlighted ? 1.008 : 1.0)
        .animation(.easeOut(duration: 0.12), value: isHighlighted)
    }

    private var cardBackground: some ShapeStyle {
        colorScheme == .dark
            ? Color.white.opacity(isHighlighted ? 0.06 : 0)
            : Color.black.opacity(isHighlighted ? 0.06 : 0)
    }
}

// MARK: - Focused values for commands

private struct QuickOpenActionKey: FocusedValueKey {
    typealias Value = () -> Void
}

private struct ToggleViewModeActionKey: FocusedValueKey {
    typealias Value = () -> Void
}

private struct TogglePinActionKey: FocusedValueKey {
    typealias Value = () -> Void
}

private struct ToggleReaderWidthActionKey: FocusedValueKey {
    typealias Value = () -> Void
}

extension FocusedValues {
    var quickOpenAction: (() -> Void)? {
        get { self[QuickOpenActionKey.self] }
        set { self[QuickOpenActionKey.self] = newValue }
    }

    var toggleViewModeAction: (() -> Void)? {
        get { self[ToggleViewModeActionKey.self] }
        set { self[ToggleViewModeActionKey.self] = newValue }
    }

    var togglePinAction: (() -> Void)? {
        get { self[TogglePinActionKey.self] }
        set { self[TogglePinActionKey.self] = newValue }
    }

    var toggleReaderWidthAction: (() -> Void)? {
        get { self[ToggleReaderWidthActionKey.self] }
        set { self[ToggleReaderWidthActionKey.self] = newValue }
    }
}

struct QuickOpenCommands: Commands {
    @FocusedValue(\.quickOpenAction) private var quickOpenAction
    @FocusedValue(\.toggleViewModeAction) private var toggleViewModeAction
    @FocusedValue(\.togglePinAction) private var togglePinAction
    @FocusedValue(\.toggleReaderWidthAction) private var toggleReaderWidthAction

    var body: some Commands {
        CommandGroup(replacing: .printItem) {
            Button("Quick Open") {
                quickOpenAction?()
            }
            .keyboardShortcut("p", modifiers: .command)
            .disabled(quickOpenAction == nil)
        }

        CommandGroup(after: .toolbar) {
            Button("Toggle Rendered/Raw") {
                toggleViewModeAction?()
            }
            .keyboardShortcut("r", modifiers: .command)
            .disabled(toggleViewModeAction == nil)

            Button("Pin Window on Top") {
                togglePinAction?()
            }
            .keyboardShortcut("p", modifiers: [.command, .shift])
            .disabled(togglePinAction == nil)

            Button("Toggle Reader Margins") {
                toggleReaderWidthAction?()
            }
            .keyboardShortcut("m", modifiers: [.command, .shift])
            .disabled(toggleReaderWidthAction == nil)
        }
    }
}
