import * as vscode from 'vscode';

type VectorNode = {
    label: string;
    description?: string;
    command?: vscode.Command;
    children?: VectorNode[];
};

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
        buildPanelData(readmeUri)
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
}

function buildPanelData(readmeUri: vscode.Uri): VectorNode[] {
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

export function deactivate() {}

