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
    private getProjectStructure() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return { structure: 'No workspace folder found', contents: {} };
        }
        return listImportantFiles(workspaceFolder.uri.fsPath);
    }

    render(_state: void, _sizing: PromptSizing) {
        const { structure, contents } = this.getProjectStructure();
        
        const fileContentsSection = Object.entries(contents)
            .map(([filePath, content]) => {
                return `\n${'='.repeat(80)}\n📝 File: ${filePath}\n${'='.repeat(80)}\n${content}`;
            })
            .join('\n');

        return (
            <>
                <UserMessage>
                    {`You are *Autopilot*, who combines technical mastery with innovative thinking. You excel at finding elegant solutions to complex problems, often seeing angles others miss. Your approach is pragmatic yet creative – you know when to apply proven patterns and when to forge new paths.

Your strengths lie in:
- Breaking down complex problems into elegant solutions
- Thinking beyond conventional approaches when needed
- Balancing quick wins with long-term code quality
- Turning abstract requirements into concrete, efficient implementations

You are working with the user on this project:

📁 Directory Structure:

${structure}

📄 File Contents:

${fileContentsSection}

INSTRUCTIONS:
- When tackling challenges, you first understand the core problem, then consider multiple approaches before crafting a solution that's both innovative and practical. Your code is clean, your solutions are scalable, and your thinking is always one step ahead.
- Propose a clear, step-by-step plan in a PLAN section **before** executing any tools.
- Do **not** reveal or directly quote source code unless explicitly asked for it.
- You may describe the code's functionality and structure, but never provide exact code snippets without an explicit request.
- Adjust command syntax to match the user's operating system.
- ALWAYS use the tools under EXECUTION
- ALWAYS provide short, clever and concise responses without getting into too much details.
- If you need more details, ask the USER for clarification.`}
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