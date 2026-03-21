//
//  EditorWebView.swift
//  Specter
//
//  Created by Andrés Campos on 3/19/26.
//

import OSLog
import SwiftUI
import WebKit

final class ZoomableEditorWebView: WKWebView {
    var isZoomActive: (() -> Bool)?

    override func magnify(with event: NSEvent) {
        if let scrollView = enclosingScrollView, scrollView.allowsMagnification {
            scrollView.magnify(with: event)
            return
        }

        super.magnify(with: event)
    }

    override func scrollWheel(with event: NSEvent) {
        if let scrollView = enclosingScrollView, isZoomActive?() == true {
            scrollView.scrollWheel(with: event)
            return
        }

        super.scrollWheel(with: event)
    }
}

final class ZoomableEditorScrollView: NSScrollView {
    let editorWebView: ZoomableEditorWebView

    init(configuration: WKWebViewConfiguration) {
        self.editorWebView = ZoomableEditorWebView(frame: .zero, configuration: configuration)
        super.init(frame: .zero)

        drawsBackground = false
        borderType = .noBorder
        hasVerticalScroller = true
        hasHorizontalScroller = true
        autohidesScrollers = true
        scrollerStyle = .overlay
        allowsMagnification = true
        usesPredominantAxisScrolling = false
        documentView = editorWebView
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layout() {
        super.layout()

        let viewportSize = contentSize
        if editorWebView.frame.size != viewportSize {
            editorWebView.frame = CGRect(origin: .zero, size: viewportSize)
        }
    }
}

struct EditorWebView: NSViewRepresentable {
    @Binding var text: String
    var mode: ViewMode
    var colorScheme: ColorScheme
    var zoomController: EditorZoomController
    var textScale: CGFloat
    var usesReaderWidth: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> ZoomableEditorScrollView {
        let configuration = WKWebViewConfiguration()
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: Coordinator.MessageName.textChanged.rawValue)
        contentController.add(context.coordinator, name: Coordinator.MessageName.openLink.rawValue)
        contentController.add(context.coordinator, name: Coordinator.MessageName.editorReady.rawValue)
        contentController.add(context.coordinator, name: Coordinator.MessageName.editorError.rawValue)
        configuration.userContentController = contentController

        let scrollView = ZoomableEditorScrollView(configuration: configuration)
        scrollView.wantsLayer = true
        scrollView.alphaValue = 1
        let webView = scrollView.editorWebView
        webView.navigationDelegate = context.coordinator
        webView.isZoomActive = { [weak zoomController] in
            zoomController?.isEffectivelyZoomed == true
        }
        webView.setValue(false, forKey: "drawsBackground")
        zoomController.attach(to: scrollView)
        context.coordinator.scrollView = scrollView
        context.coordinator.webView = webView
        context.coordinator.loadEditor(into: webView)
        return scrollView
    }

    func updateNSView(_ scrollView: ZoomableEditorScrollView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        coordinator.scrollView = scrollView
        coordinator.webView = scrollView.editorWebView
        scrollView.editorWebView.isZoomActive = { [weak zoomController] in
            zoomController?.isEffectivelyZoomed == true
        }
        zoomController.attach(to: scrollView)
        coordinator.pushStateIfNeeded()
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        enum MessageName: String {
            case textChanged
            case openLink
            case editorReady
            case editorError
        }

        private static let logger = Logger(
            subsystem: Bundle.main.bundleIdentifier ?? "cloudnine.Specter",
            category: "EditorWebView"
        )

        var parent: EditorWebView
        weak var scrollView: ZoomableEditorScrollView?
        weak var webView: WKWebView?

        private var isEditorReady = false
        private var lastKnownText: String
        private var lastKnownMode: ViewMode?
        private var lastKnownTheme: String?
        private var lastKnownTextScale: CGFloat?
        private var lastKnownReaderWidth: Bool?
        private var modeTransitionNonce = 0

        init(_ parent: EditorWebView) {
            self.parent = parent
            self.lastKnownText = parent.text
        }

        func loadEditor(into webView: WKWebView) {
            let editorURL =
                Bundle.main.url(
                    forResource: "index",
                    withExtension: "html",
                    subdirectory: "Editor"
                ) ??
                Bundle.main.url(
                    forResource: "index",
                    withExtension: "html"
                )

            guard let editorURL else {
                Self.logger.error("Editor bundle missing from app resources.")
                webView.loadHTMLString(
                    "<html><body style=\"font-family: -apple-system; padding: 24px;\">Missing editor bundle.</body></html>",
                    baseURL: nil
                )
                return
            }

            webView.loadFileURL(
                editorURL,
                allowingReadAccessTo: editorURL.deletingLastPathComponent()
            )
        }

        func pushStateIfNeeded(force: Bool = false) {
            guard isEditorReady, let webView else { return }

            if force || parent.text != lastKnownText {
                lastKnownText = parent.text
                pushText(parent.text, into: webView)
            }

            if force || lastKnownMode != parent.mode {
                let previousMode = lastKnownMode
                lastKnownMode = parent.mode

                if force || previousMode == nil {
                    scrollView?.alphaValue = 1
                    pushMode(parent.mode.rawValue, into: webView)
                } else {
                    transitionMode(
                        parent.mode,
                        in: webView
                    )
                }
            }

            let theme = parent.colorScheme == .dark ? "dark" : "light"
            if force || lastKnownTheme != theme {
                lastKnownTheme = theme
                pushTheme(theme, into: webView)
            }

            if force || lastKnownTextScale != parent.textScale {
                lastKnownTextScale = parent.textScale
                pushTextScale(parent.textScale, into: webView)
            }

            if force || lastKnownReaderWidth != parent.usesReaderWidth {
                lastKnownReaderWidth = parent.usesReaderWidth
                pushReaderWidth(parent.usesReaderWidth, into: webView)
            }
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard let name = MessageName(rawValue: message.name) else { return }

            switch name {
            case .textChanged:
                guard let text = message.body as? String else { return }
                lastKnownText = text
                DispatchQueue.main.async {
                    self.parent.text = text
                }
            case .openLink:
                guard
                    let payload = message.body as? [String: Any],
                    let rawURL = payload["url"] as? String,
                    let url = URL(string: rawURL)
                else {
                    return
                }
                NSWorkspace.shared.open(url)
            case .editorReady:
                Self.logger.debug("Editor signaled readiness.")
                isEditorReady = true
                pushStateIfNeeded(force: true)
            case .editorError:
                if let payload = message.body as? [String: Any] {
                    Self.logger.error("Editor error: \(String(describing: payload), privacy: .public)")
                } else {
                    Self.logger.error("Editor error message received with unexpected payload.")
                }
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            Self.logger.debug("Editor page finished navigation.")
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation!,
            withError error: Error
        ) {
            Self.logger.error("Editor navigation failed: \(error.localizedDescription, privacy: .public)")
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            Self.logger.error("Editor provisional navigation failed: \(error.localizedDescription, privacy: .public)")
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            Self.logger.error("Editor web content process terminated.")
        }

        private func pushText(_ text: String, into webView: WKWebView) {
            evaluate(
                "editor.setText(text)",
                arguments: ["text": text],
                in: webView
            )
        }

        private func transitionMode(_ mode: ViewMode, in webView: WKWebView) {
            guard let scrollView else {
                pushMode(mode.rawValue, into: webView)
                return
            }

            modeTransitionNonce += 1
            let transitionNonce = modeTransitionNonce

            scrollView.layer?.removeAllAnimations()

            NSAnimationContext.animate(.easeOut(duration: 0.09)) {
                scrollView.alphaValue = 0
            } completion: { [weak self] in
                guard let self,
                      transitionNonce == self.modeTransitionNonce
                else {
                    return
                }

                self.pushMode(mode.rawValue, into: webView) { [weak self] in
                    guard let self,
                          transitionNonce == self.modeTransitionNonce,
                          let scrollView = self.scrollView
                    else {
                        return
                    }

                    scrollView.layer?.removeAllAnimations()
                    scrollView.alphaValue = 0

                    NSAnimationContext.animate(.easeIn(duration: 0.13)) {
                        scrollView.alphaValue = 1
                    }
                }
            }
        }

        private func pushMode(
            _ mode: String,
            into webView: WKWebView,
            completion: (() -> Void)? = nil
        ) {
            evaluate(
                "editor.setMode(mode)",
                arguments: ["mode": mode],
                in: webView,
                completion: completion
            )
        }

        private func pushTheme(_ theme: String, into webView: WKWebView) {
            evaluate(
                "editor.setTheme(theme)",
                arguments: ["theme": theme],
                in: webView
            )
        }

        private func pushTextScale(_ scale: CGFloat, into webView: WKWebView) {
            evaluate(
                "editor.setTextScale(scale)",
                arguments: ["scale": scale],
                in: webView
            )
        }

        private func pushReaderWidth(_ enabled: Bool, into webView: WKWebView) {
            evaluate(
                "editor.setReaderWidth(enabled)",
                arguments: ["enabled": enabled],
                in: webView
            )
        }

        private func evaluate(
            _ script: String,
            arguments: [String: Any],
            in webView: WKWebView,
            completion: (() -> Void)? = nil
        ) {
            webView.callAsyncJavaScript(
                script,
                arguments: arguments,
                in: nil,
                in: .page
            ) { result in
                if case .failure(let error) = result {
                    Self.logger.error("Editor bridge call failed: \(error.localizedDescription, privacy: .public)")
                }

                DispatchQueue.main.async {
                    completion?()
                }
            }
        }
    }
}
