import * as vscode from 'vscode';
import fetch from 'node-fetch';

type VectorNode = {
    label: string;
    description?: string;
    command?: vscode.Command;
    children?: VectorNode[];
};

type ChatMessage = {
    role: 'user' | 'assistant';
    content: string;
};

type OllamaChatResponse = {
    message?: ChatMessage;
    done?: boolean;
};

type OllamaGenerateResponse = {
    response: string;
    done?: boolean;
};

const CHAT_STATE_KEY = 'vector.chatHistory';

class VectorTreeItem extends vscode.TreeItem {
    constructor(public readonly node: VectorNode) {
        super(
            node.label,
            node.children && node.children.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );

        this.description = node.description;
        this.tooltip = node.description || node.label;
        this.command = node.command;
        this.contextValue = node.children && node.children.length > 0 ? 'vectorSection' : 'vectorItem';
    }
}

class VectorTreeDataProvider implements vscode.TreeDataProvider<VectorTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<VectorTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private readonly getNodes: () => VectorNode[]) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: VectorTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: VectorTreeItem): vscode.ProviderResult<VectorTreeItem[]> {
        if (!element) {
            return this.getNodes().map((node) => new VectorTreeItem(node));
        }

        const children = element.node.children ?? [];
        return children.map((node) => new VectorTreeItem(node));
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Vector extension is now active!');

    const readmeUri = vscode.Uri.joinPath(context.extensionUri, 'README.md');
    const provider = new VectorTreeDataProvider(() =>
        buildPanelData(readmeUri, getChatHistory(context))
    );

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('vectorPanelView', provider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vector.helloWorld', () => {
            vscode.window.showInformationMessage('Hello World from Vector Extension!');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vector.refreshPanel', () => provider.refresh())
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vector.sendMessage', async () => {
            await sendPrompt(context, provider);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vector.clearConversation', async () => {
            await context.globalState.update(CHAT_STATE_KEY, []);
            provider.refresh();
            vscode.window.showInformationMessage('Vector conversation cleared.');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vector.showMessage', async (message: ChatMessage) => {
            if (!message) {
                return;
            }

            await showMessageDetail(message);
        })
    );
}

function buildPanelData(readmeUri: vscode.Uri, history: ChatMessage[]): VectorNode[] {
    return [
        {
            label: 'Getting Started',
            children: [
                {
                    label: 'Run Hello World',
                    description: 'Trigger the sample command',
                    command: {
                        command: 'vector.helloWorld',
                        title: 'Run Hello World'
                    }
                },
                {
                    label: 'Open README',
                    description: 'View project documentation',
                    command: {
                        command: 'vscode.open',
                        title: 'Open README',
                        arguments: [readmeUri]
                    }
                }
            ]
        },
        conversationSection(history),
        {
            label: 'Actions',
            children: [
                {
                    label: 'Send Prompt',
                    description: 'Ask Vector + Ollama something',
                    command: {
                        command: 'vector.sendMessage',
                        title: 'Send Prompt'
                    }
                },
                {
                    label: 'Clear Conversation',
                    description: 'Reset the chat history',
                    command: {
                        command: 'vector.clearConversation',
                        title: 'Clear Conversation'
                    }
                },
                {
                    label: 'Refresh Panel',
                    description: 'Reload data',
                    command: {
                        command: 'vector.refreshPanel',
                        title: 'Refresh Panel'
                    }
                }
            ]
        },
        {
            label: 'Environment',
            children: [
                {
                    label: 'Workspace',
                    description: vscode.workspace.name ?? 'No folder open'
                },
                {
                    label: 'Node Version',
                    description: process.version
                },
                {
                    label: 'VS Code API',
                    description: vscode.version
                }
            ]
        }
    ];
}

function conversationSection(history: ChatMessage[]): VectorNode {
    if (!history.length) {
        return {
            label: 'Conversation',
            description: 'No messages yet',
            children: [
                {
                    label: 'Start chatting',
                    description: 'Run Vector: Send Prompt',
                    command: {
                        command: 'vector.sendMessage',
                        title: 'New Prompt'
                    }
                }
            ]
        };
    }

    return {
        label: 'Conversation',
        children: history.map((message, index) => ({
            label: `${message.role === 'user' ? 'You' : 'Vector'}: ${truncate(
                message.content
            )}`,
            description: `#${index + 1}`,
            tooltip: message.content,
            command: {
                command: 'vector.showMessage',
                title: 'Show Message',
                arguments: [message]
            }
        }))
    };
}

async function sendPrompt(
    context: vscode.ExtensionContext,
    provider: VectorTreeDataProvider
): Promise<void> {
    const prompt = await vscode.window.showInputBox({
        prompt: 'What should Vector + Ollama do?',
        placeHolder: 'Describe a code change, ask a question, or provide directions.'
    });

    if (!prompt) {
        return;
    }

    const history = getChatHistory(context);
    const config = vscode.workspace.getConfiguration('vector');
    const baseUrl = config.get<string>('ollama.baseUrl', 'http://localhost:11434');
    const model = config.get<string>('ollama.model', 'llama3');

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Vector',
            cancellable: false
        },
        async (progress) => {
            progress.report({ message: 'Contacting Ollama...' });

            try {
                // Build prompt from conversation history
                const conversationPrompt = history
                    .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
                    .join('\n\n');
                const fullPrompt = conversationPrompt
                    ? `${conversationPrompt}\n\nUser: ${prompt}\n\nAssistant:`
                    : prompt;

                const response = await fetch(`${baseUrl}/api/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model,
                        prompt: fullPrompt,
                        stream: false
                    })
                });

                if (!response.ok) {
                    throw new Error(`Ollama responded with status ${response.status}`);
                }

                const data = (await response.json()) as OllamaGenerateResponse;
                const assistantContent = data.response?.trim();

                if (!assistantContent) {
                    throw new Error('Received empty response from Ollama.');
                }

                const nextHistory = [
                    ...history,
                    { role: 'user', content: prompt },
                    { role: 'assistant', content: assistantContent }
                ];

                await context.globalState.update(CHAT_STATE_KEY, nextHistory);
                provider.refresh();
                vscode.window.showInformationMessage('Vector response added to the panel.');
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Vector chat failed: ${message}`);
            }
        }
    );
}

function getChatHistory(context: vscode.ExtensionContext): ChatMessage[] {
    return context.globalState.get<ChatMessage[]>(CHAT_STATE_KEY, []);
}

function truncate(value: string, length = 80): string {
    return value.length > length ? `${value.slice(0, length - 3)}...` : value;
}

async function showMessageDetail(message: ChatMessage): Promise<void> {
    const document = await vscode.workspace.openTextDocument({
        content: message.content,
        language: 'markdown'
    });

    await vscode.window.showTextDocument(document, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside
    });
}

export function deactivate() {}

