import * as vscode from 'vscode';
import { OverrideItem } from './types';

export class OverrideDetector {
    public async detectOverrides(editor: vscode.TextEditor): Promise<OverrideItem[]> {
        const document = editor.document;
        console.log(`[OverrideMark] Detecting overrides for ${document.uri.toString()}`);

        // Only process Python files
        if (document.languageId !== 'python') {
            console.log('[OverrideMark] Not a python file');
            return [];
        }

        let symbols: vscode.DocumentSymbol[] | undefined;
        let retries = 10; // Increase retries
        let attempt = 0;

        while (attempt < retries) {
            try {
                symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                    'vscode.executeDocumentSymbolProvider',
                    document.uri
                );

                if (symbols && symbols.length > 0) {
                    console.log(`[OverrideMark] Found ${symbols.length} root symbols`);
                    break;
                }
                console.log(`[OverrideMark] Found 0 symbols, retrying... (${retries - attempt} left)`);
            } catch (e: any) {
                const msg = e.message || '';
                if (msg.includes('LanguageServerClient must be initialized first') || msg.includes('Language server is not ready')) {
                    console.log(`[OverrideMark] Language server not ready, waiting... (${retries - attempt} left)`);
                } else {
                    console.error('[OverrideMark] Error getting symbols:', e);
                }
            }

            attempt++;
            if (attempt < retries) {
                // Exponential backoff or fixed delay
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        if (!symbols || symbols.length === 0) {
            console.log('[OverrideMark] Giving up: No symbols found after retries');
            return [];
        }

        const results: OverrideItem[] = [];

        // Map to store potential parent methods: "ClassName.MethodName" -> Location
        const classMethods = new Map<string, vscode.Location>();

        // First pass: Index all class methods in the current file
        const indexMethods = (symbol: vscode.DocumentSymbol, className: string) => {
            for (const child of symbol.children) {
                if (child.kind === vscode.SymbolKind.Method) {
                    classMethods.set(`${className}.${child.name}`, new vscode.Location(document.uri, child.selectionRange));
                }
            }
        };

        for (const symbol of symbols) {
            if (symbol.kind === vscode.SymbolKind.Class) {
                indexMethods(symbol, symbol.name);
            }
        }

        for (const symbol of symbols) {
            if (symbol.kind === vscode.SymbolKind.Class) {
                console.log(`[OverrideMark] Processing class ${symbol.name}`);
                await this.processClass(document, symbol, results, classMethods);
            }
        }

        console.log(`[OverrideMark] Found ${results.length} items`);
        return results;
    }

    private async processClass(
        document: vscode.TextDocument,
        classSymbol: vscode.DocumentSymbol,
        results: OverrideItem[],
        localClassMethods: Map<string, vscode.Location>
    ) {
        // 1. Identify parent classes
        const parentLocations = await this.findParentLocations(document, classSymbol);
        console.log(`[OverrideMark] Class ${classSymbol.name} has ${parentLocations.length} parent locations`);

        if (parentLocations.length === 0) {
            return;
        }

        // 2. Collect all methods from immediate parents
        const parentMethods = new Map<string, { loc: vscode.Location, className: string }>();
        const parentClassNames: string[] = [];

        for (const loc of parentLocations) {
            try {
                console.log(`[OverrideMark] Resolving parent at ${loc.uri.toString()}`);
                const remoteSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                    'vscode.executeDocumentSymbolProvider',
                    loc.uri
                );

                if (!remoteSymbols) {
                    console.log(`[OverrideMark] No symbols found for parent at ${loc.uri.toString()}`);
                    continue;
                }

                const parentClassSymbol = this.findSymbolAtLocation(remoteSymbols, loc.range);
                if (parentClassSymbol) {
                    console.log(`[OverrideMark] Found parent class symbol: ${parentClassSymbol.name}`);
                    parentClassNames.push(parentClassSymbol.name);
                    for (const child of parentClassSymbol.children) {
                        if (child.kind === vscode.SymbolKind.Method) {
                            // Store location for navigation
                            const methodLoc = new vscode.Location(loc.uri, child.selectionRange);
                            parentMethods.set(child.name, { loc: methodLoc, className: parentClassSymbol.name });
                        }
                    }
                } else {
                    console.log(`[OverrideMark] Could not find class symbol at location range`);
                }
            } catch (e) {
                console.error(`[OverrideMark] Error processing parent at ${loc.uri}:`, e);
            }
        }

        console.log(`[OverrideMark] Parent methods: ${Array.from(parentMethods.keys()).join(', ')}`);

        // 3. Check current class methods against parent methods (Override Detection)
        for (const child of classSymbol.children) {
            if (child.kind === vscode.SymbolKind.Method) {
                if (parentMethods.has(child.name)) {
                    console.log(`[OverrideMark] Found override: ${child.name}`);

                    const parentInfo = parentMethods.get(child.name);
                    if (parentInfo) {
                        results.push({
                            type: 'override',
                            range: child.selectionRange,
                            parentMethodName: `${parentInfo.className}.${child.name}`,
                            parentUri: parentInfo.loc.uri,
                            parentRange: parentInfo.loc.range
                        });
                    }

                    // 4. Check if the parent is in the SAME file and mark it as implemented
                    for (const parentName of parentClassNames) {
                        const key = `${parentName}.${child.name}`;
                        if (localClassMethods.has(key)) {
                            // Logic fix: localClassMethods maps "ClassName.MethodName" to its location.
                            // We want to mark the PARENT method with a link to the CHILD method.
                            // The 'key' here is "ParentClassName.MethodName".
                            // So we are looking up the parent method's location in the current file.

                            const parentMethodLoc = localClassMethods.get(key);
                            if (parentMethodLoc) {
                                results.push({
                                    type: 'implementation',
                                    range: parentMethodLoc.range,
                                    parentMethodName: `${classSymbol.name}.${child.name}`, // Here parentMethodName is used to describe "Implemented in Child"
                                    parentUri: document.uri,
                                    parentRange: child.selectionRange
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    private async findParentLocations(document: vscode.TextDocument, classSymbol: vscode.DocumentSymbol): Promise<vscode.Location[]> {
        const locations: vscode.Location[] = [];

        // Simple regex to find parent names in "class ClassName(Parent1, Parent2):"
        // We limit the search to the start line of the class.
        const lineText = document.lineAt(classSymbol.range.start.line).text;
        console.log(`[OverrideMark] Class definition line: ${lineText}`);
        const match = /class\s+\w+\s*\(([^)]+)\)/.exec(lineText);

        if (match && match[1]) {
            const parents = match[1].split(',').map(p => p.trim());
            console.log(`[OverrideMark] Identified potential parents: ${parents.join(', ')}`);

            for (const parent of parents) {
                const parentIndex = lineText.indexOf(parent);
                if (parentIndex >= 0) {
                    const pos = new vscode.Position(classSymbol.range.start.line, parentIndex);
                    try {
                        const definition = await vscode.commands.executeCommand<vscode.Location | vscode.Location[] | vscode.LocationLink[]>(
                            'vscode.executeDefinitionProvider',
                            document.uri,
                            pos
                        );

                        if (definition) {
                            if (Array.isArray(definition)) {
                                if (definition.length > 0) {
                                    const first = definition[0];
                                    if ('targetUri' in first) {
                                        locations.push(new vscode.Location(first.targetUri, first.targetRange));
                                    } else {
                                        locations.push(first as vscode.Location);
                                    }
                                }
                            } else {
                                locations.push(definition as vscode.Location);
                            }
                        } else {
                            console.log(`[OverrideMark] No definition found for parent ${parent}`);
                        }
                    } catch (e) {
                        console.error(`[OverrideMark] Error resolving parent ${parent}:`, e);
                    }
                }
            }
        } else {
            console.log(`[OverrideMark] No parent pattern match for ${classSymbol.name}`);
        }
        return locations;
    }

    private findSymbolAtLocation(symbols: vscode.DocumentSymbol[], range: vscode.Range): vscode.DocumentSymbol | undefined {
        for (const symbol of symbols) {
            // Check if the symbol's range contains the target range
            // The target range is usually the definition range of the class name
            if (symbol.range.contains(range.start)) {
                // If it has children, check them first (nested classes)
                if (symbol.children.length > 0) {
                    const child = this.findSymbolAtLocation(symbol.children, range);
                    if (child) return child;
                }
                // If it's a class, return it
                if (symbol.kind === vscode.SymbolKind.Class) {
                    return symbol;
                }
            }
        }
        return undefined;
    }
}
