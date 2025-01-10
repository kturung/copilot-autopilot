import * as fs from 'fs';
import * as path from 'path';

function readGitignore(workspacePath: string): string[] {
    const gitignorePath = path.join(workspacePath, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
        return [];
    }

    try {
        const content = fs.readFileSync(gitignorePath, 'utf-8');
        return content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .map(pattern => pattern.replace(/^\/+|\/+$/g, '')); // Remove leading/trailing slashes
    } catch {
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
    '*.txt',
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

// Replace the direct push with Set operation to handle duplicates
const defaultIgnoredSet = new Set(defaultIgnored);
readGitignore(process.cwd()).forEach(pattern => defaultIgnoredSet.add(pattern));
const defaultIgnoredArray = Array.from(defaultIgnoredSet);

// Add debug log
console.log('Final ignore patterns:', defaultIgnoredArray);

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

export function listImportantFiles(dir: string, level: number = 0, contents: { [path: string]: string } = {}): FileDetails {
    let structure = '';
    const list = fs.readdirSync(dir);

    list.forEach(file => {
        const filePath = path.join(dir, file);
        const relativePath = path.relative(dir, filePath);
        const stat = fs.statSync(filePath);

        if (isIgnored(relativePath, defaultIgnoredArray)) {
            return;
        }

        if (stat && stat.isDirectory()) {
            structure += '  '.repeat(level) + file + '/\n';
            const subDirResult = listImportantFiles(filePath, level + 1, contents);
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
