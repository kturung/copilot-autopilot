import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

interface IFileOperationParams {
    path?: string;
    paths?: string[];
    content?: string;
}

export class FileReadTool implements vscode.LanguageModelTool<IFileOperationParams> {
    private addLineNumbers(content: string, startLine: number = 1): string {
        const lines = content.split('\n');
        const maxLineNumberWidth = String(startLine + lines.length - 1).length;
        return lines
            .map((line, index) => {
                const lineNumber = String(startLine + index).padStart(maxLineNumberWidth, ' ');
                return `${lineNumber} | ${line}`;
            })
            .join('\n');
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<IFileOperationParams>,
        _token: vscode.CancellationToken
    ) {
        try {
            const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            if (!workspacePath) {
                throw new Error('No workspace folder found');
            }

            const filePaths = options.input.paths || (options.input.path ? [options.input.path] : []);
            
            const results = await Promise.all(filePaths.map(async (filePath) => {
                const fullPath = path.join(workspacePath, filePath);
                try {
                    const content = await fs.readFile(fullPath, 'utf-8');
                    return [
                        '=' .repeat(80),
                        `📝 File: ${filePath}`,
                        '=' .repeat(80),
                        this.addLineNumbers(content)
                    ].join('\n');
                } catch (err) {
                    return `Error reading ${filePath}: ${(err as Error)?.message}`;
                }
            }));

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(results.join('\n\n'))
            ]);
        } catch (err: unknown) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Error reading files: ${(err as Error)?.message}`)
            ]);
        }
    }
}