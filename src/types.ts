import * as vscode from 'vscode';

export interface OverrideItem {
    type: 'override' | 'implementation';
    range: vscode.Range; // The range of the method name
    parentMethodName: string;
    parentUri: vscode.Uri;
    parentRange: vscode.Range;
}
