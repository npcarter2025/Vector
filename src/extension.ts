import * as vscode from 'vscode';
import { VectorWebviewProvider } from './VectorWebviewProvider';
import { testIndexingInfrastructure } from './indexing/test';

export function activate(context: vscode.ExtensionContext) {
    console.log('Vector extension is now active!');

    // Register webview provider
    const webviewProvider = new VectorWebviewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            VectorWebviewProvider.viewType,
            webviewProvider
        )
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('vector.helloWorld', () => {
            vscode.window.showInformationMessage('Hello World from Vector Extension!');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vector.clearConversation', async () => {
            await context.globalState.update('vector.chatHistory', []);
            vscode.window.showInformationMessage('Vector conversation cleared.');
        })
    );

    // Test indexing infrastructure
    context.subscriptions.push(
        vscode.commands.registerCommand('vector.testIndexing', async () => {
            const result = await testIndexingInfrastructure(context);
            const doc = await vscode.workspace.openTextDocument({
                content: result,
                language: 'plaintext'
            });
            await vscode.window.showTextDocument(doc);
        })
    );
}

export function deactivate() {}
