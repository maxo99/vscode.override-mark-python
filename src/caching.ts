import * as vscode from 'vscode';

export interface SubclassInfo {
    symbol: vscode.DocumentSymbol;
    uri: vscode.Uri;
}

export class SubclassCache {
    private static instance: SubclassCache;
    // Key: "ParentUri::ParentClassName" -> Value: List of subclasses
    private cache: Map<string, SubclassInfo[]> = new Map();

    private constructor() { }

    public static getInstance(): SubclassCache {
        if (!SubclassCache.instance) {
            SubclassCache.instance = new SubclassCache();
        }
        return SubclassCache.instance;
    }

    public get(parentUri: vscode.Uri, parentClassName: string): SubclassInfo[] | undefined {
        const key = this.getKey(parentUri, parentClassName);
        return this.cache.get(key);
    }

    public set(parentUri: vscode.Uri, parentClassName: string, subclasses: SubclassInfo[]): void {
        const key = this.getKey(parentUri, parentClassName);
        this.cache.set(key, subclasses);
    }

    public clear(): void {
        this.cache.clear();
    }

    private getKey(uri: vscode.Uri, className: string): string {
        return `${uri.toString()}::${className}`;
    }
}

export class ReferenceClassificationCache {
    private static instance: ReferenceClassificationCache;
    // Key: "Uri::Line:Char" -> Value: boolean (true = is subclass definition, false = is not)
    private cache: Map<string, boolean> = new Map();

    private constructor() { }

    public static getInstance(): ReferenceClassificationCache {
        if (!ReferenceClassificationCache.instance) {
            ReferenceClassificationCache.instance = new ReferenceClassificationCache();
        }
        return ReferenceClassificationCache.instance;
    }

    public get(uri: vscode.Uri, range: vscode.Range): boolean | undefined {
        const key = this.getKey(uri, range);
        return this.cache.get(key);
    }

    public set(uri: vscode.Uri, range: vscode.Range, isSubclass: boolean): void {
        const key = this.getKey(uri, range);
        this.cache.set(key, isSubclass);
    }

    /**
     * Invalidates all entries for a specific file.
     * Call this when a file changes.
     */
    public invalidateFile(uri: vscode.Uri): void {
        const uriStr = uri.toString();
        for (const key of this.cache.keys()) {
            if (key.startsWith(uriStr)) {
                this.cache.delete(key);
            }
        }
    }

    public clear(): void {
        this.cache.clear();
    }

    private getKey(uri: vscode.Uri, range: vscode.Range): string {
        return `${uri.toString()}::${range.start.line}:${range.start.character}`;
    }
}
