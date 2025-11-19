import * as vscode from 'vscode';
import { OverrideItem } from './types';

export class OverrideCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    private items: OverrideItem[] = [];

    public updateResults(items: OverrideItem[]) {
        this.items = items;
        this._onDidChangeCodeLenses.fire();
    }

    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];

        for (const item of this.items) {
            // Ensure the item belongs to the current document (sanity check, though items are usually per-editor)
            // Since we update results globally for the active editor, we might need to be careful.
            // Actually, CodeLens is per document. We should store a map of uri -> items if we want to support multiple open files.
            // For this MVP, we are re-scanning on active editor change, so we can just return items if they match the document.

            // Ideally, the detector should cache results per document URI.
            // But for now, let's assume the 'items' are for the active document.

            const title = item.type === 'override'
                ? `$(arrow-up) Overrides ${item.parentMethodName}`
                : `$(arrow-down) Implemented in ${item.parentMethodName}`; // parentMethodName here is actually the child class name for 'implementation' type based on previous logic

            // Adjust title logic:
            // For 'override': parentMethodName is "ParentClass.method"
            // For 'implementation': parentMethodName is "ChildClass.method"

            const label = item.type === 'override'
                ? `Overrides ${item.parentMethodName}`
                : `Implemented in ${item.parentMethodName}`;

            const command: vscode.Command = {
                title: label,
                command: 'pythonOverrideMark.navigateTo',
                arguments: [
                    item.parentUri.toString(),
                    item.parentRange.start.line,
                    item.parentRange.start.character
                ]
            };

            lenses.push(new vscode.CodeLens(item.range, command));
        }

        return lenses;
    }
}
