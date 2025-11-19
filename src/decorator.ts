import * as vscode from 'vscode';
import * as path from 'path';

import { OverrideItem } from './types';

export class OverrideDecorator {
    private overrideDecorationType: vscode.TextEditorDecorationType;
    private implementedDecorationType: vscode.TextEditorDecorationType;

    constructor(context: vscode.ExtensionContext) {
        this.overrideDecorationType = vscode.window.createTextEditorDecorationType({
            gutterIconPath: context.asAbsolutePath(path.join('images', 'arrow-up.svg')),
            gutterIconSize: 'contain'
        });
        this.implementedDecorationType = vscode.window.createTextEditorDecorationType({
            gutterIconPath: context.asAbsolutePath(path.join('images', 'arrow-down.svg')),
            gutterIconSize: 'contain'
        });

        console.log('[OverrideMark] Decorator initialized with icons at:',
            context.asAbsolutePath(path.join('images', 'arrow-up.svg')),
            context.asAbsolutePath(path.join('images', 'arrow-down.svg'))
        );
    }

    public updateDecorations(editor: vscode.TextEditor, items: OverrideItem[]) {
        console.log(`[OverrideMark] Updating decorations: ${items.length} items`);

        const overrides: vscode.DecorationOptions[] = [];
        const implemented: vscode.DecorationOptions[] = [];

        for (const item of items) {
            const args = [item.parentUri.toString(), item.parentRange.start.line, item.parentRange.start.character];
            const commandUri = vscode.Uri.parse(`command:pythonOverrideMark.navigateTo?${encodeURIComponent(JSON.stringify(args))}`);

            const label = item.type === 'override'
                ? `Overrides ${item.parentMethodName}`
                : `Implemented in ${item.parentMethodName}`;

            const md = new vscode.MarkdownString(`${label}. [Go to location](${commandUri})`);
            md.isTrusted = true;

            const decoration: vscode.DecorationOptions = {
                range: item.range,
                hoverMessage: md
            };

            if (item.type === 'override') {
                overrides.push(decoration);
            } else {
                implemented.push(decoration);
            }
        }

        editor.setDecorations(this.overrideDecorationType, overrides);
        editor.setDecorations(this.implementedDecorationType, implemented);
    }

    public dispose() {
        this.overrideDecorationType.dispose();
        this.implementedDecorationType.dispose();
    }
}
