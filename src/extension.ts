import * as vscode from 'vscode';
import { registerToolUserChatParticipant } from './toolParticipant';
import { FileReadTool, FileWriteTool, FileUpdateTool, CommandRunTool, ApplyDiffTool } from './tools';
import { DiffView } from './components/DiffView';

export function activate(context: vscode.ExtensionContext) {
    console.log('Cogent extension is now active!');
    
    // Register tools
    context.subscriptions.push(
        vscode.lm.registerTool('cogent_readFile', new FileReadTool()),
        vscode.lm.registerTool('cogent_writeFile', new FileWriteTool()),
        vscode.lm.registerTool('cogent_updateFile', new FileUpdateTool()),
        vscode.lm.registerTool('cogent_runCommand', new CommandRunTool()),
        vscode.lm.registerTool('cogent_applyDiff', new ApplyDiffTool())
    );
    
    // Register the tool participant
    registerToolUserChatParticipant(context);
}

export function deactivate() {
    DiffView.dispose();
}