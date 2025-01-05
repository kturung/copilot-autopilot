import * as vscode from 'vscode';
import * as fs from 'fs/promises';

export interface UnsavedChangesResult {
    hasChanges: boolean;
    diskContent?: string;
    editorContent?: string;
    error?: string;
}

export class UnsavedChangesDetector {
    /**
     * Checks for unsaved changes in a file by comparing disk content with editor content
     * @param filePath Relative path to the file from workspace root
     * @returns UnsavedChangesResult containing change status and content details
     */
    static async detectChanges(filePath: string): Promise<UnsavedChangesResult> {
        try {
            // Get the workspace URI
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return { 
                    hasChanges: false, 
                    error: 'No workspace folder found' 
                };
            }

            // Create URI for the file
            const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
            
            // Try to find the document in open editors
            const document = vscode.workspace.textDocuments.find(
                doc => doc.uri.fsPath === fileUri.fsPath
            );

            if (!document) {
                return {
                    hasChanges: false,
                    error: 'File is not open in any editor'
                };
            }

            // Get content from disk
            const diskContent = await fs.readFile(fileUri.fsPath, 'utf-8');
            const editorContent = document.getText();

            // Compare contents
            const hasChanges = diskContent !== editorContent;

            return {
                hasChanges,
                diskContent,
                editorContent
            };

        } catch (error) {
            return {
                hasChanges: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Gets all documents with unsaved changes in the workspace
     * @returns Array of file paths with unsaved changes
     */
    static async getAllUnsavedChanges(): Promise<string[]> {
        const unsavedFiles: string[] = [];
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        
        if (!workspaceFolder) {
            return unsavedFiles;
        }

        // Check all open text documents
        for (const document of vscode.workspace.textDocuments) {
            if (document.isDirty) {
                // Get relative path from workspace root
                const relativePath = vscode.workspace.asRelativePath(document.uri);
                unsavedFiles.push(relativePath);
            }
        }

        return unsavedFiles;
    }

    /**
     * Watches for changes in a specific file
     * @param filePath Relative path to the file from workspace root
     * @param onChange Callback function when changes are detected
     * @returns Disposable to stop watching
     */
    static watchForChanges(
        filePath: string, 
        onChange: (result: UnsavedChangesResult) => void
    ): vscode.Disposable {
        const disposables: vscode.Disposable[] = [];

        // Get the workspace URI
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return new vscode.Disposable(() => {});
        }

        const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);

        // Watch for document changes
        const changeDisposable = vscode.workspace.onDidChangeTextDocument(async e => {
            if (e.document.uri.fsPath === fileUri.fsPath) {
                const result = await UnsavedChangesDetector.detectChanges(filePath);
                onChange(result);
            }
        });

        disposables.push(changeDisposable);

        // Return composite disposable
        return vscode.Disposable.from(...disposables);
    }
}