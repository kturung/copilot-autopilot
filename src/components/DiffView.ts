import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from './Logger';

export class DiffView {
    private static readonly scheme = 'cogent-diff';
    private static contentProvider: vscode.TextDocumentContentProvider;
    private static registration: vscode.Disposable;
    private static content = new Map<string, string>();

    private originalUri: vscode.Uri;
    private modifiedUri: vscode.Uri;
    private document?: vscode.TextDocument;
    private disposables: vscode.Disposable[] = [];

    constructor(filePath: string, originalContent: string) {
        this.originalUri = vscode.Uri.file(filePath);
        this.modifiedUri = this.originalUri.with({ scheme: DiffView.scheme });
        
        // Initialize static content provider if not exists
        if (!DiffView.contentProvider) {
            DiffView.contentProvider = {
                provideTextDocumentContent: (uri: vscode.Uri) => {
                    return DiffView.content.get(uri.toString()) || '';
                },
                onDidChange: new vscode.EventEmitter<vscode.Uri>().event
            };
            DiffView.registration = vscode.workspace.registerTextDocumentContentProvider(
                DiffView.scheme,
                DiffView.contentProvider
            );
        }
        
        // Store the original content
        DiffView.content.set(this.modifiedUri.toString(), originalContent);
    }

    async show(): Promise<boolean> {
        try {
            const logger = Logger.getInstance();
            // Open the file first
            this.document = await vscode.workspace.openTextDocument(this.originalUri);
            
            // Add save listener
            this.disposables.push(
                vscode.workspace.onDidSaveTextDocument(async doc => {
                    if (doc.uri.toString() === this.originalUri.toString()) {
                        await this.close();
                        // Show the saved file
                        const document = await vscode.workspace.openTextDocument(this.originalUri);
                        await vscode.window.showTextDocument(document, {
                            preview: false,
                            viewColumn: vscode.ViewColumn.Active
                        });
                    }
                })
            );
            
            // Show diff editor
            await vscode.commands.executeCommand('vscode.diff',
                this.modifiedUri,
                this.originalUri,
                `${path.basename(this.originalUri.fsPath)} (Working Tree)`,
                { preview: true }
            );

            return true;
        } catch (error) {
            const logger = Logger.getInstance();
            logger.error(`Failed to open diff view: ${error}`);
            return false;
        }
    }

    async update(content: string, _line: number) {
        if (!this.document) return;

        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            0, 0,
            this.document.lineCount, 0
        );
        
        edit.replace(this.originalUri, fullRange, content);
        await vscode.workspace.applyEdit(edit);
    }

    async close() {
        // Clean up the stored content
        DiffView.content.delete(this.modifiedUri.toString());
        // Dispose all listeners
        this.disposables.forEach(d => d.dispose());
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }

    static dispose() {
        if (DiffView.registration) {
            DiffView.registration.dispose();
        }
        DiffView.content.clear();
    }
}