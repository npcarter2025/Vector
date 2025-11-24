import * as vscode from 'vscode';

export function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function getExtensionUri(context?: vscode.ExtensionContext): vscode.Uri {
    if (context) {
        return context.extensionUri;
    }
    const extension = vscode.extensions.getExtension('vector-extension');
    if (!extension) {
        throw new Error('Vector extension not found');
    }
    return extension.extensionUri;
}

