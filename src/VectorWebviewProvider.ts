import * as vscode from 'vscode';
import { getNonce } from './util/vscode';
import { OllamaClient, OllamaChatMessage } from './ollamaClient';

export class VectorWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'vectorPanelView';
    private _webview?: vscode.Webview;
    private _webviewView?: vscode.WebviewView;

    constructor(private readonly _context: vscode.ExtensionContext) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        try {
            this._webviewView = webviewView;
            this._webview = webviewView.webview;

            webviewView.webview.options = {
                enableScripts: true,
                localResourceRoots: [this._context.extensionUri],
            };

            webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        } catch (error) {
            console.error('Error resolving webview:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            webviewView.webview.html = `<!DOCTYPE html>
                <html>
                <body>
                    <h1>Error loading Vector Panel</h1>
                    <p>${errorMessage}</p>
                </body>
                </html>`;
        }

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'sendMessage':
                        await this._handleSendMessage(message.text);
                        break;
                    case 'clearHistory':
                        await this._handleClearHistory();
                        break;
                    case 'ready':
                        await this._sendHistoryToWebview();
                        await this._checkOllamaConnection();
                        break;
                    case 'checkConnection':
                        await this._checkOllamaConnection();
                        break;
                }
            },
            undefined,
            this._context.subscriptions
        );
    }

    private async _handleSendMessage(text: string): Promise<void> {
        if (!this._webview) return;

        // Add user message to history
        const history = this._getHistory();
        const userMessage: OllamaChatMessage = { role: 'user', content: text };
        const newHistory = [...history, { ...userMessage, timestamp: Date.now() }];
        await this._saveHistory(newHistory);

        // Send user message to webview
        this._webview.postMessage({
            command: 'addMessage',
            message: { ...userMessage, timestamp: Date.now() },
        });

        // Get response from Ollama using OllamaClient
        const config = vscode.workspace.getConfiguration('vector');
        const baseUrl = config.get<string>('ollama.baseUrl', 'http://localhost:11434');
        const model = config.get<string>('ollama.model', 'gemma3:1b');

        try {
            const client = new OllamaClient(baseUrl, model);
            
            // Convert history to OllamaChatMessage format (without timestamp)
            const ollamaMessages: OllamaChatMessage[] = newHistory
                .slice(0, -1) // All messages except the current user message
                .map(msg => ({ role: msg.role, content: msg.content }));

            // Add the current user message
            ollamaMessages.push(userMessage);

            const assistantContent = await client.sendMessage(ollamaMessages);

            const assistantMessage = {
                role: 'assistant' as const,
                content: assistantContent,
                timestamp: Date.now(),
            };

            const updatedHistory = [...newHistory, assistantMessage];
            await this._saveHistory(updatedHistory);

            // Send assistant message to webview
            this._webview.postMessage({
                command: 'addMessage',
                message: assistantMessage,
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._webview.postMessage({
                command: 'error',
                message: `Failed to get response: ${errorMessage}`,
            });
        }
    }

    private async _checkOllamaConnection(): Promise<void> {
        if (!this._webview) return;

        const config = vscode.workspace.getConfiguration('vector');
        const baseUrl = config.get<string>('ollama.baseUrl', 'http://localhost:11434');
        const model = config.get<string>('ollama.model', 'gemma3:1b');

        try {
            const client = new OllamaClient(baseUrl, model);
            const status = await client.checkConnection();
            
            this._webview.postMessage({
                command: 'connectionStatus',
                connected: status.connected,
                error: status.error,
                baseUrl,
                model,
            });
        } catch (error) {
            this._webview.postMessage({
                command: 'connectionStatus',
                connected: false,
                error: error instanceof Error ? error.message : String(error),
                baseUrl,
                model,
            });
        }
    }

    private async _handleClearHistory(): Promise<void> {
        await this._context.globalState.update('vector.chatHistory', []);
        if (this._webview) {
            this._webview.postMessage({ command: 'clearMessages' });
        }
    }

    private async _sendHistoryToWebview(): Promise<void> {
        if (!this._webview) return;
        const history = this._getHistory();
        this._webview.postMessage({
            command: 'loadHistory',
            messages: history,
        });
    }

    private _getHistory(): Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }> {
        return this._context.globalState.get<Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>>(
            'vector.chatHistory',
            []
        );
    }

    private async _saveHistory(history: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>): Promise<void> {
        await this._context.globalState.update('vector.chatHistory', history);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const extensionUri = this._context.extensionUri;
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, 'media', 'main.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, 'media', 'main.css')
        );
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};">
                <link href="${styleUri}" rel="stylesheet">
                <title>Vector Chat</title>
            </head>
            <body>
                <div id="root"></div>
                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    console.log('Vector webview initialized');
                </script>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

