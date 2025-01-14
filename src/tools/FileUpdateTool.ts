import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DiffView } from '../components/DiffView';
import { UnsavedChangesDetector } from '../components/UnsavedChangesDetector';

interface IFileOperationParams {
    path?: string;
    paths?: string[];
    content?: string;
}

export class FileUpdateTool implements vscode.LanguageModelTool<IFileOperationParams> {
    private diffView?: DiffView;

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<IFileOperationParams>,
        _token: vscode.CancellationToken
    ) {
        try {
            const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            if (!workspacePath) {
                throw new Error('No workspace folder found');
            }
            if (!options.input.path) {
                throw new Error('File path is required');
            }
            const filePath = path.join(workspacePath, options.input.path);
            
            // Check for unsaved changes first
            const unsavedChanges = await UnsavedChangesDetector.detectChanges(options.input.path);
            const currentContent = unsavedChanges.editorContent || await fs.readFile(filePath, 'utf-8');
            
            // Check if file is too large using current content
            const lineCount = currentContent.split('\n').length;
            if (lineCount > 200) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        "This file exceeds 200 lines. Please retry the operation using the 'cogent_applyDiff' tool instead for better handling of large file modifications."
                    )
                ]);
            }
            this.diffView = new DiffView(filePath, currentContent);
            await this.diffView.show();
            
            if (options.input.content) {
                const lines = options.input.content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    await this.diffView.update(
                        lines.slice(0, i + 1).join('\n'),
                        i
                    );
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Changes shown in diff view for ${options.input.path}. Review and save to apply changes.`)
            ]);
        } catch (err: unknown) {
            if (this.diffView) {
                await this.diffView.close();
            }
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Error updating file: ${(err as Error)?.message}`)
            ]);
        }
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<IFileOperationParams>,
        _token: vscode.CancellationToken
    ) {
        const autoConfirm = vscode.workspace.getConfiguration('cogent').get('autoConfirmTools.updateFile', false);
        
        if (autoConfirm) {
            return {
                invocationMessage: `Updating file: ${options.input.path}`
            };
        }

        return {
            invocationMessage: `Updating file: ${options.input.path}`,
            confirmationMessages: {
                title: 'Update File',
                message: new vscode.MarkdownString(`Update contents of ${options.input.path}?`)
            }
        };
    }
}