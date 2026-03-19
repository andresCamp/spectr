//
//  EditorWebView.swift
//  Specter
//
//  Created by Andrés Campos on 3/19/26.
//

import OSLog
import SwiftUI
import WebKit

struct EditorWebView: NSViewRepresentable {
    @Binding var text: String
    var mode: ViewMode
    var colorScheme: ColorScheme

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: Coordinator.MessageName.textChanged.rawValue)
        contentController.add(context.coordinator, name: Coordinator.MessageName.editorReady.rawValue)
        contentController.add(context.coordinator, name: Coordinator.MessageName.editorError.rawValue)
        configuration.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")
        context.coordinator.webView = webView
        context.coordinator.loadEditor(into: webView)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        coordinator.pushStateIfNeeded()
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        enum MessageName: String {
            case textChanged
            case editorReady
            case editorError
        }

        private static let logger = Logger(
            subsystem: Bundle.main.bundleIdentifier ?? "cloudnine.Specter",
            category: "EditorWebView"
        )

        var parent: EditorWebView
        weak var webView: WKWebView?

        private var isEditorReady = false
        private var lastKnownText: String
        private var lastKnownMode: ViewMode?
        private var lastKnownTheme: String?

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
                lastKnownMode = parent.mode
                pushMode(parent.mode.rawValue, into: webView)
            }

            let theme = parent.colorScheme == .dark ? "dark" : "light"
            if force || lastKnownTheme != theme {
                lastKnownTheme = theme
                pushTheme(theme, into: webView)
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

        private func pushMode(_ mode: String, into webView: WKWebView) {
            evaluate(
                "editor.setMode(mode)",
                arguments: ["mode": mode],
                in: webView
            )
        }

        private func pushTheme(_ theme: String, into webView: WKWebView) {
            evaluate(
                "editor.setTheme(theme)",
                arguments: ["theme": theme],
                in: webView
            )
        }

        private func evaluate(
            _ script: String,
            arguments: [String: Any],
            in webView: WKWebView
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
            }
        }
    }
}
