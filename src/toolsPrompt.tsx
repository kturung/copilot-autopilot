import {
    AssistantMessage,
    BasePromptElementProps,
    Chunk,
    PrioritizedList,
    PromptElement,
    PromptElementProps,
    PromptMetadata,
    PromptPiece,
    PromptReference,
    PromptSizing,
    ToolCall,
    ToolMessage,
    UserMessage
} from '@vscode/prompt-tsx';
import { ToolResult } from '@vscode/prompt-tsx/dist/base/promptElements';
import * as vscode from 'vscode';
import { isTsxToolUserMetadata } from './toolParticipant';
import { listImportantFiles } from './components/listFiles';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ToolCallRound {
    response: string;
    toolCalls: vscode.LanguageModelToolCallPart[];
}

export interface ToolUserProps extends BasePromptElementProps {
    request: vscode.ChatRequest;
    context: vscode.ChatContext;
    toolCallRounds: ToolCallRound[];
    toolCallResults: Record<string, vscode.LanguageModelToolResult>;
}

export class ToolUserPrompt extends PromptElement<ToolUserProps, void> {
    private async getCustomInstructions(): Promise<string> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return '';
        }

        try {
            const rulesPath = path.join(workspaceFolder.uri.fsPath, '.cogentrules');
            const content = await fs.readFile(rulesPath, 'utf-8');
            return content.trim();
        } catch (error) {
            // File doesn't exist or can't be read, return empty string
            return '';
        }
    }

    private getProjectStructure() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return { structure: 'No workspace folder found', contents: {} };
        }
        return listImportantFiles(workspaceFolder.uri.fsPath);
    }

    private getOSLevel(): string {
        return process.platform === 'win32' 
            ? 'Windows' 
            : process.platform === 'darwin' 
                ? 'macOS' 
                : 'Linux';
    }

    private getShellType(): string {
        return process.platform === 'win32' 
            ? 'PowerShell' 
            : process.platform === 'darwin'
                ? 'zsh'
                : 'bash';
    }

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

    async render(_state: void, _sizing: PromptSizing) {
        const { structure, contents } = this.getProjectStructure();
        const useFullWorkspace = vscode.workspace.getConfiguration('cogent').get('use_full_workspace', true);
        const customInstructions = await this.getCustomInstructions();
        const osLevel = this.getOSLevel();
        const shellType = this.getShellType();
        
        const fileContentsSection = useFullWorkspace
            ? Object.entries(contents)
                .map(([filePath, content]) => {
                    return `\n${'='.repeat(80)}\n📝 File: ${filePath}\n${'='.repeat(80)}\n${this.addLineNumbers(content)}`;
                })
                .join('\n')
            : '';


        const customInstructionsSection = customInstructions 
            ? `\n## User's Custom Instructions\nThe following additional instructions are provided by the user, and should be followed to the best of your ability without interfering with the TOOL USE guidelines.\n${customInstructions}`
            : '';

        return (
            <>
                <UserMessage>
                    {`You are cogent, a coding assistant that combines technical mastery with innovative thinking. You excel at finding elegant solutions to complex problems and seeing angles others miss. Your approach balances pragmatic solutions with creative thinking.

## Core Strengths
- Breaking down complex problems into elegant solutions
- Thinking beyond conventional approaches when needed
- Balancing quick wins with long-term code quality
- Turning requirements into efficient implementations

## Project Context
📁 Directory Structure:

${structure}
${useFullWorkspace ? `\n📄 File Contents:\n${fileContentsSection}` : ''}

## User's OS Level
- ${osLevel} (using ${shellType})

## Critical Rules
- Always create a PLAN section first by thinking step-by-step
- Never reveal source code unless explicitly requested
- Keep responses concise and focused
- DO NOT suggest the user commands to be executed, use cogent_runCommand to execute it yourself.
- Ask for clarification if requirements are unclear

## Tool Use Instructions
1. cogent_updateFile
   - NEVER use this tool for files that have more than 200 lines
   - MUST provide complete file content
   - Ensure all required imports are added or updated
   - No partial updates or placeholder comments
   - Include ALL existing code when updating

2. cogent_writeFile
   - MUST provide complete new file content
   - No placeholder comments or partial code
   - Ensure proper file structure and formatting
   - DO NOT use this tool for existing files

3. cogent_runCommand
   - Avoid running dangerous commands
   - Run commands according to User's OS Level and Shell Type
   - Commands that create a template or scaffold a project should use the current working directory, avoid creating sub folder projects.

4. cogent_apply_diff
   - Only a single operation is allowed per tool use.
   - Ensure all required imports are added or updated
   - The SEARCH section must exactly match existing content including whitespace and indentation.
   - If you're not confident in the exact content to search for, use the cogent_readFile tool first to get the exact content.

    Diff format:
    \`\`\`
    <<<<<<< SEARCH
    [exact content to find including whitespace]
    =======
    [new content to replace with]
    >>>>>>> REPLACE
    \`\`\`

    Example:

    Original file:
    \`\`\`
    1 | def calculate_total(items):
    2 |     total = 0
    3 |     for item in items:
    4 |         total += item
    5 |     return total
    \`\`\`

    Search/Replace content:
    \`\`\`
    <<<<<<< SEARCH
    def calculate_total(items):
        total = 0
        for item in items:
            total += item
        return total
    =======
    def calculate_total(items):
        """Calculate total with 10% markup"""
        return sum(item * 1.1 for item in items)
    >>>>>>> REPLACE
    \`\`\`

    Usage:

    path: <File path here>
    diff: <Your search/replace content here>
    start_line: 1
    end_line: 5

${customInstructionsSection}
`}
                </UserMessage>
                <History context={this.props.context} priority={10} />
                <PromptReferences
                    references={this.props.request.references}
                    priority={20}
                />
                <UserMessage>{this.props.request.prompt}</UserMessage>
                <ToolCalls
                    toolCallRounds={this.props.toolCallRounds}
                    toolInvocationToken={this.props.request.toolInvocationToken}
                    toolCallResults={this.props.toolCallResults} />
            </>
        );
    }
}

interface ToolCallsProps extends BasePromptElementProps {
    toolCallRounds: ToolCallRound[];
    toolCallResults: Record<string, vscode.LanguageModelToolResult>;
    toolInvocationToken: vscode.ChatParticipantToolToken | undefined;
}

const dummyCancellationToken: vscode.CancellationToken = new vscode.CancellationTokenSource().token;

class ToolCalls extends PromptElement<ToolCallsProps, void> {
    async render(_state: void, _sizing: PromptSizing) {
        if (!this.props.toolCallRounds.length) {
            return undefined;
        }

        return <>
            {this.props.toolCallRounds.map(round => this.renderOneToolCallRound(round))}
            <UserMessage>Above is the result of calling one or more tools. The user cannot see the results, so you should explain them to the user if referencing them in your answer.</UserMessage>
        </>;
    }

    private renderOneToolCallRound(round: ToolCallRound) {
        const assistantToolCalls: ToolCall[] = round.toolCalls.map(tc => ({ 
            type: 'function', 
            function: { 
                name: tc.name, 
                arguments: JSON.stringify(tc.input) 
            }, 
            id: tc.callId 
        }));
        
        return (
            <Chunk>
                <AssistantMessage toolCalls={assistantToolCalls}>{round.response}</AssistantMessage>
                {round.toolCalls.map(toolCall =>
                    <ToolResultElement 
                        toolCall={toolCall} 
                        toolInvocationToken={this.props.toolInvocationToken} 
                        toolCallResult={this.props.toolCallResults[toolCall.callId]} 
                    />
                )}
            </Chunk>
        );
    }
}

interface ToolResultElementProps extends BasePromptElementProps {
    toolCall: vscode.LanguageModelToolCallPart;
    toolInvocationToken: vscode.ChatParticipantToolToken | undefined;
    toolCallResult: vscode.LanguageModelToolResult | undefined;
}

class ToolResultElement extends PromptElement<ToolResultElementProps, void> {
    async render(state: void, sizing: PromptSizing): Promise<PromptPiece | undefined> {
        const tool = vscode.lm.tools.find(t => t.name === this.props.toolCall.name);
        if (!tool) {
            console.error(`Tool not found: ${this.props.toolCall.name}`);
            return <ToolMessage toolCallId={this.props.toolCall.callId}>Tool not found</ToolMessage>;
        }

        const tokenizationOptions: vscode.LanguageModelToolTokenizationOptions = {
            tokenBudget: sizing.tokenBudget,
            countTokens: async (content: string) => sizing.countTokens(content),
        };

        const toolResult = this.props.toolCallResult ??
            await vscode.lm.invokeTool(
                this.props.toolCall.name, 
                { 
                    input: this.props.toolCall.input, 
                    toolInvocationToken: this.props.toolInvocationToken, 
                    tokenizationOptions 
                }, 
                dummyCancellationToken
            );

        return (
            <ToolMessage toolCallId={this.props.toolCall.callId}>
                <meta value={new ToolResultMetadata(this.props.toolCall.callId, toolResult)}></meta>
                <ToolResult data={toolResult} />
            </ToolMessage>
        );
    }
}

export class ToolResultMetadata extends PromptMetadata {
    constructor(
        public toolCallId: string,
        public result: vscode.LanguageModelToolResult,
    ) {
        super();
    }
}

interface HistoryProps extends BasePromptElementProps {
    priority: number;
    context: vscode.ChatContext;
}

class History extends PromptElement<HistoryProps, void> {
    render(_state: void, _sizing: PromptSizing) {
        return (
            <PrioritizedList priority={this.props.priority} descending={false}>
                {this.props.context.history.map((message) => {
                    if (message instanceof vscode.ChatRequestTurn) {
                        return (
                            <>
                                <PromptReferences 
                                    references={message.references} 
                                    excludeReferences={true} 
                                />
                                <UserMessage>{message.prompt}</UserMessage>
                            </>
                        );
                    } else if (message instanceof vscode.ChatResponseTurn) {
                        const metadata = message.result.metadata;
                        if (isTsxToolUserMetadata(metadata) && metadata.toolCallsMetadata.toolCallRounds.length > 0) {
                            return <ToolCalls 
                                toolCallResults={metadata.toolCallsMetadata.toolCallResults} 
                                toolCallRounds={metadata.toolCallsMetadata.toolCallRounds} 
                                toolInvocationToken={undefined} 
                            />;
                        }
                        return <AssistantMessage>{chatResponseToString(message)}</AssistantMessage>;
                    }
                })}
            </PrioritizedList>
        );
    }
}

function chatResponseToString(response: vscode.ChatResponseTurn): string {
    return response.response
        .map((r) => {
            if (r instanceof vscode.ChatResponseMarkdownPart) {
                return r.value.value;
            } else if (r instanceof vscode.ChatResponseAnchorPart) {
                if (r.value instanceof vscode.Uri) {
                    return r.value.fsPath;
                } else {
                    return r.value.uri.fsPath;
                }
            }
            return '';
        })
        .join('');
}

interface PromptReferencesProps extends BasePromptElementProps {
    references: ReadonlyArray<vscode.ChatPromptReference>;
    excludeReferences?: boolean;
}

class PromptReferences extends PromptElement<PromptReferencesProps, void> {
    render(_state: void, _sizing: PromptSizing): PromptPiece {
        return (
            <UserMessage>
                {this.props.references.map(ref => (
                    <PromptReferenceElement 
                        ref={ref} 
                        excludeReferences={this.props.excludeReferences} 
                    />
                ))}
            </UserMessage>
        );
    }
}

interface PromptReferenceProps extends BasePromptElementProps {
    ref: vscode.ChatPromptReference;
    excludeReferences?: boolean;
}

class PromptReferenceElement extends PromptElement<PromptReferenceProps> {
    async render(_state: void, _sizing: PromptSizing): Promise<PromptPiece | undefined> {
        const value = this.props.ref.value;
        if (value instanceof vscode.Uri) {
            const fileContents = (await vscode.workspace.fs.readFile(value)).toString();
            return (
                <Tag name="context">
                    {!this.props.excludeReferences && 
                        <references value={[new PromptReference(value)]} />}
                    {value.fsPath}:<br />
                    ``` <br />
                    {fileContents}<br />
                    ```<br />
                </Tag>
            );
        } else if (value instanceof vscode.Location) {
            const rangeText = (await vscode.workspace.openTextDocument(value.uri))
                .getText(value.range);
            return (
                <Tag name="context">
                    {!this.props.excludeReferences && 
                        <references value={[new PromptReference(value)]} />}
                    {value.uri.fsPath}:{value.range.start.line + 1}-
                    {value.range.end.line + 1}: <br />
                    ```<br />
                    {rangeText}<br />
                    ```
                </Tag>
            );
        } else if (typeof value === 'string') {
            return <Tag name="context">{value}</Tag>;
        }
    }
}

type TagProps = PromptElementProps<{
    name: string;
}>;

class Tag extends PromptElement<TagProps> {
    private static readonly _regex = /^[a-zA-Z_][\w.-]*$/;

    render() {
        const { name } = this.props;
        if (!Tag._regex.test(name)) {
            throw new Error(`Invalid tag name: ${this.props.name}`);
        }
        return (
            <>
                {'<' + name + '>'}<br />
                <>{this.props.children}<br /></>
                {'</' + name + '>'}<br />
            </>
        );
    }
}
