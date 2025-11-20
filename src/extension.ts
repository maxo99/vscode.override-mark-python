import * as vscode from 'vscode';
import { OverrideDetector } from './overrideDetector';
import { OverrideCodeLensProvider } from './codeLensProvider';
import { SubclassCache, ReferenceClassificationCache } from './caching';

export function activate(context: vscode.ExtensionContext) {


    const detector = new OverrideDetector();
    const codeLensProvider = new OverrideCodeLensProvider();

    // Register CodeLens Provider
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider({ language: 'python', scheme: 'file' }, codeLensProvider)
    );

    let activeEditor = vscode.window.activeTextEditor;
    let timeout: NodeJS.Timeout | undefined = undefined;

    const triggerUpdate = () => {
        if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
        }
        // Debounce
        const delay = vscode.workspace.getConfiguration('pythonOverrideMark').get<number>('debounceDelay', 500);
        timeout = setTimeout(() => {
            if (activeEditor && activeEditor.document.languageId === 'python') {
                // Ensure Python extension is activated
                const pythonExtension = vscode.extensions.getExtension('ms-python.python');
                if (pythonExtension && !pythonExtension.isActive) {

                    pythonExtension.activate().then(() => {

                        // Re-trigger update after activation
                        triggerUpdate();
                    });
                    return; // Exit to avoid running detection before Python extension is ready
                }

                detector.detectOverrides(activeEditor).then(items => {
                    codeLensProvider.updateResults(items);
                }).catch(error => {
                    console.error('Error updating override marks:', error);
                });
            }
        }, delay);
    };

    // Initial check with a slight delay to allow other extensions to start
    if (activeEditor) {
        setTimeout(triggerUpdate, 1000);
    }

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            activeEditor = editor;
            if (editor) {
                triggerUpdate();
            }
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            if (activeEditor && event.document === activeEditor.document) {
                triggerUpdate();
            }

            // Cache Invalidation
            // 1. Reference Classification: Always invalidate for the changed file
            ReferenceClassificationCache.getInstance().invalidateFile(event.document.uri);

            // 2. Subclass Cache: Invalidate if 'class' keyword is involved or simply clear all for safety
            // Optimization: Check if changes involve 'class' keyword
            const contentChanges = event.contentChanges;
            const involvesClass = contentChanges.some(c => c.text.includes('class') || c.text.includes('(') || c.text.includes(')'));

            if (involvesClass) {
                SubclassCache.getInstance().clear();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('pythonOverrideMark.navigateTo', async (uriStr: string, line: number, character: number) => {

            try {
                const uri = vscode.Uri.parse(uriStr);
                const position = new vscode.Position(line, character);
                const document = await vscode.workspace.openTextDocument(uri);
                const editor = await vscode.window.showTextDocument(document);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            } catch (e) {
                console.error('[OverrideMark] Error navigating:', e);
            }
        }),
        vscode.commands.registerCommand('pythonOverrideMark.showOverrides', async (overrides: { name: string, uri: vscode.Uri, range: vscode.Range }[]) => {
            if (!overrides || overrides.length === 0) return;

            if (overrides.length === 1) {
                const target = overrides[0];
                vscode.commands.executeCommand('pythonOverrideMark.navigateTo', target.uri.toString(), target.range.start.line, target.range.start.character);
                return;
            }

            const items = overrides.map(o => ({
                label: o.name,
                description: '',
                target: o
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select an override to navigate to'
            });

            if (selected) {
                const target = selected.target;
                vscode.commands.executeCommand('pythonOverrideMark.navigateTo', target.uri.toString(), target.range.start.line, target.range.start.character);
            }
        })
    );
}

export function deactivate() { }
