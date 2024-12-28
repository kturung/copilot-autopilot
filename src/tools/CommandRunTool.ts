import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

interface ICommandParams {
    command: string;
}

// Utility function to load node-pty
function loadNodePty() {
    try {
        //@ts-ignore
        const requireFunc = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;
        const moduleName = path.join(vscode.env.appRoot, "node_modules", "node-pty");
        return requireFunc(moduleName);
    } catch (error) {
        console.error('Failed to load node-pty:', error);
        return null;
    }
}

export class CommandRunTool implements vscode.LanguageModelTool<ICommandParams> {
    private static terminal: vscode.Terminal | undefined;
    private static nodePty = loadNodePty();

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ICommandParams>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const stripAnsi = (str: string) => {
            return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
        };
        return new Promise((resolve, reject) => {
            if (!CommandRunTool.nodePty) {
                return resolve(new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart('Error: node-pty not available')
                ]));
            }

            const shell = os.platform() === 'win32' ? 'powershell.exe' : 'zsh';
            let output = '';
            let writeEmitter = new vscode.EventEmitter<string>();

            const ptyProcess = CommandRunTool.nodePty.spawn(shell, [], {
                name: 'xterm-color',
                cols: 80,
                rows: 30,
                cwd: vscode.workspace.workspaceFolders?.[0].uri.fsPath || process.cwd(),
                env: process.env
            });

            ptyProcess.onData((data: string) => {
                output += stripAnsi(data);
                writeEmitter.fire(data);
            });

            const ptyTerminal = vscode.window.createTerminal({
                name: 'Autopilot Command',
                pty: {
                    onDidWrite: writeEmitter.event,
                    open: () => {
                        ptyProcess.write(`${options.input.command}\r`);
                        // Add exit command after the main command
                        setTimeout(() => {
                            ptyProcess.write('\rexit\r');
                        }, 100);
                    },
                    close: () => {
                        ptyProcess.kill();
                        writeEmitter.dispose();
                    },
                    handleInput: (data: string) => {
                        ptyProcess.write(data);
                    },
                    setDimensions: (dimensions: vscode.TerminalDimensions) => {
                        ptyProcess.resize(dimensions.columns, dimensions.rows);
                    }
                }
            });

            let exitTimeout = setTimeout(() => {
                ptyProcess.kill();
                resolve(new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(stripAnsi(output) || 'Command timed out')
                ]));
            }, 30000); // 30 second timeout

            token.onCancellationRequested(() => {
                clearTimeout(exitTimeout);
                ptyProcess.kill();
                reject(new Error('Command cancelled'));
            });

            ptyTerminal.show();
            
            // Listen for process exit
            ptyProcess.onExit(() => {
                clearTimeout(exitTimeout);
                resolve(new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(stripAnsi(output) || 'Command completed')
                ]));
            });
        });
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ICommandParams>,
        _token: vscode.CancellationToken
    ) {
        return {
            invocationMessage: `Executing command: ${options.input.command}`,
            confirmationMessages: {
                title: 'Run Command',
                message: new vscode.MarkdownString(`Execute command: \`${options.input.command}\`?`)
            }
        };
    }
}