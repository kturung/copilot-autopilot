import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './Logger';

function readGitignore(workspacePath: string): string[] {
    const logger = Logger.getInstance();
    const gitignorePath = path.join(workspacePath, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
        logger.info('No .gitignore file found at: ' + gitignorePath);
        return [];
    }

    try {
        const content = fs.readFileSync(gitignorePath, 'utf-8');

        const patterns = content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .map(pattern => pattern.replace(/^\/+|\/+$/g, '')); // Remove leading/trailing slashes
        
        logger.debug('Processed .gitignore patterns: ' + JSON.stringify(patterns, null, 2));
        return patterns;
    } catch (error) {
        logger.error('Error reading .gitignore: ' + error);
        return [];
    }
}

const defaultIgnored = [
    // Build and distribution
    'dist',
    'build',
    'out',
    'target',
    'bin',
    'lib',
    '.next',
    'public',
    
    // Dependencies
    'node_modules',
    'package-lock.json',
    'bower_components',
    'vendor',
    'packages',
    
    // Environment and virtual environments
    '.venv',
    'venv',
    'env',
    '.env',
    'virtualenv',
    
    // Version control
    '.git',
    '.svn',
    '.hg',
    
    // IDE and editor files
    '.idea',
    '.vscode',
    '.vs',
    '.sublime-workspace',
    
    // Cache and temp files
    '.cache',
    'tmp',
    'temp',
    '__pycache__',
    
    // System files
    '.DS_Store',
    '*.db',
    
    // Test and coverage
    'coverage',
    '.nyc_output',
    '.pytest_cache',
    
    // Logs
    'logs',
    '*.log',
    'npm-debug.log*',
    'yarn-debug.log*',
    'yarn-error.log*',

    // Images and media
    'assets',
    '*.jpg',
    '*.jpeg',
    '*.png',
    '*.gif',
    '*.webp',
    '*.mov',
    '*.flv',
    '*.wmv',
    '*.swf',
    '*.fla',
    '*.svg',
    '*.ico',
    '*.webm',
    '*.woff'

];

function isIgnored(filePath: string, ignorePatterns: string[]): boolean {
    return ignorePatterns.some(pattern => {
        const cleanPattern = pattern.replace(/\/$/, '');
        const escaped = cleanPattern
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*');
        const regex = new RegExp(`^${escaped}(?:$|/.*$)`);
        return regex.test(filePath);
    });
}

interface FileDetails {
    structure: string;
    contents: { [path: string]: string };
}

export function listImportantFiles(dir: string, level: number = 0, contents: { [path: string]: string } = {}, ignorePatterns?: string[]): FileDetails {
    const logger = Logger.getInstance();
    let structure = '';
    const list = fs.readdirSync(dir);

    // Only read .gitignore at root level
    if (level === 0) {
        const gitignorePatterns = readGitignore(dir);
        const defaultIgnoredSet = new Set([...defaultIgnored, ...gitignorePatterns]);
        ignorePatterns = Array.from(defaultIgnoredSet);
        logger.debug('Root level ignore patterns: ' + JSON.stringify(ignorePatterns, null, 2));
    }

    list.forEach(file => {
        const filePath = path.join(dir, file);
        const relativePath = path.relative(dir, filePath);
        const stat = fs.statSync(filePath);

        if (isIgnored(relativePath, ignorePatterns || [])) {
            return;
        }

        if (stat && stat.isDirectory()) {
            structure += '  '.repeat(level) + file + '/\n';
            const subDirResult = listImportantFiles(filePath, level + 1, contents, ignorePatterns);
            structure += subDirResult.structure;
            Object.assign(contents, subDirResult.contents);
        } else {
            structure += '  '.repeat(level) + file + '\n';
            try {
                // Check file size first
                const stats = fs.statSync(filePath);
                if (stats.size > 1024 * 1024) { // 1MB limit
                    contents[relativePath] = `File too large (${Math.round(stats.size / 1024 / 1024)}MB), skipped`;
                    return;
                }
                contents[relativePath] = fs.readFileSync(filePath, 'utf-8');
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                contents[relativePath] = `Error reading file: ${errorMessage}`;
            }
        }
    });

    return { structure, contents };
}
