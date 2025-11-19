import * as vscode from 'vscode';
import { OverrideItem } from './types';

export class OverrideDetector {
    public async detectOverrides(editor: vscode.TextEditor): Promise<OverrideItem[]> {
        const document = editor.document;


        // Only process Python files
        if (document.languageId !== 'python') {

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

                    break;
                }

            } catch (e: any) {
                const msg = e.message || '';
                if (msg.includes('LanguageServerClient must be initialized first') || msg.includes('Language server is not ready')) {

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

                await this.processClass(document, symbol, results, classMethods);
            }
        }


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




        // 2. Collect all methods from immediate parents (Only if parents exist)
        const parentMethods = new Map<string, { loc: vscode.Location, className: string }>();
        const parentClassNames: string[] = [];

        if (parentLocations.length > 0) {
            for (const loc of parentLocations) {
                try {

                    const remoteSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                        'vscode.executeDocumentSymbolProvider',
                        loc.uri
                    );

                    if (!remoteSymbols) {

                        continue;
                    }

                    const parentClassSymbol = this.findSymbolAtLocation(remoteSymbols, loc.range);
                    if (parentClassSymbol) {

                        parentClassNames.push(parentClassSymbol.name);
                        for (const child of parentClassSymbol.children) {
                            if (child.kind === vscode.SymbolKind.Method) {
                                // Store location for navigation
                                const methodLoc = new vscode.Location(loc.uri, child.selectionRange);
                                parentMethods.set(child.name, { loc: methodLoc, className: parentClassSymbol.name });
                            }
                        }
                    } else {

                    }
                } catch (e) {
                    console.error(`[OverrideMark] Error processing parent at ${loc.uri}:`, e);
                }
            }

        }

        // 3. Check current class methods against parent methods (Override Detection)
        // Map to aggregate implementations: ParentMethodKeyString -> { parentRange: Range, children: ChildInfo[] }
        const implementations = new Map<string, { parentRange: vscode.Range, children: { name: string, uri: vscode.Uri, range: vscode.Range }[] }>();

        for (const child of classSymbol.children) {
            if (child.kind === vscode.SymbolKind.Method) {
                // Only check for overrides if we have parent methods
                if (parentMethods.size > 0 && parentMethods.has(child.name)) {


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

                    // (Legacy logic removed in favor of provider-based approach below)
                }
            }
        }

        // 5. Subclass Detection (Reference Based)
        // We find references to the current class to identify subclasses
        const subclasses = await this.findSubclasses(document, classSymbol);

        for (const { symbol: subclassSymbol, uri: subclassUri } of subclasses) {
            for (const child of subclassSymbol.children) {
                if (child.kind === vscode.SymbolKind.Method) {
                    // Check if this method overrides a method in the current class (Animal)
                    const animalMethod = classSymbol.children.find(c => c.name === child.name && c.kind === vscode.SymbolKind.Method);

                    if (animalMethod) {
                        const parentKey = `${animalMethod.range.start.line}:${animalMethod.range.start.character}`;
                        if (!implementations.has(parentKey)) {
                            implementations.set(parentKey, { parentRange: animalMethod.selectionRange, children: [] });
                        }

                        // Avoid duplicates if we somehow process the same thing twice
                        const children = implementations.get(parentKey)!.children;
                        const childId = `${subclassUri.toString()}:${child.selectionRange.start.line}`;
                        // We don't have a unique ID in the children array, so let's just check if we have one with same URI and range
                        const exists = children.some(c => c.uri.toString() === subclassUri.toString() && c.range.isEqual(child.selectionRange));

                        if (!exists) {
                            children.push({
                                name: `${subclassSymbol.name}.${child.name}`,
                                uri: subclassUri,
                                range: child.selectionRange
                            });
                        }
                    }
                }
            }
        }

        // Convert aggregated implementations to results
        for (const item of implementations.values()) {
            if (item.children.length > 0) {
                results.push({
                    type: 'implementation',
                    range: item.parentRange,
                    childMethods: item.children
                });
            }
        }
    }



    private async findSubclasses(document: vscode.TextDocument, classSymbol: vscode.DocumentSymbol): Promise<{ symbol: vscode.DocumentSymbol, uri: vscode.Uri }[]> {
        const subclasses: { symbol: vscode.DocumentSymbol, uri: vscode.Uri }[] = [];
        try {

            const refs = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                document.uri,
                classSymbol.selectionRange.start // Name of the class
            );

            if (!refs) {

                return [];
            }



            // Group by URI to avoid opening the same doc multiple times
            const refsByUri = new Map<string, vscode.Range[]>();
            for (const ref of refs) {
                const uriStr = ref.uri.toString();
                if (!refsByUri.has(uriStr)) {
                    refsByUri.set(uriStr, []);
                }
                refsByUri.get(uriStr)?.push(ref.range);
            }

            for (const [uriStr, ranges] of refsByUri) {
                const uri = vscode.Uri.parse(uriStr);

                let doc: vscode.TextDocument;
                try {
                    if (uri.toString() === document.uri.toString()) {
                        doc = document;
                    } else {
                        doc = await vscode.workspace.openTextDocument(uri);
                    }
                } catch (e) {
                    console.error(`[OverrideMark] Failed to open document ${uriStr}`, e);
                    continue;
                }

                const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                    'vscode.executeDocumentSymbolProvider',
                    uri
                );
                if (!symbols) continue;

                for (const range of ranges) {
                    // Check if this reference is a subclass definition
                    const lineText = doc.lineAt(range.start.line).text;
                    // Regex to match "class Subclass(..., Parent, ...):"
                    // We need to match the class name and ensure 'classSymbol.name' is in the parens.
                    // Note: classSymbol.name is the Parent class name.
                    const classNameRegex = new RegExp(`class\\s+(\\w+)\\s*\\(.*\\b${classSymbol.name}\\b.*\\)`);
                    const match = classNameRegex.exec(lineText);

                    if (match && match[1]) {
                        const subclassName = match[1];

                        // Find the symbol for this subclass
                        const subClassSymbol = this.findClassSymbol(symbols, subclassName);
                        if (subClassSymbol) {
                            // Avoid duplicates
                            if (!subclasses.some(s => s.symbol.name === subClassSymbol.name && s.uri.toString() === uriStr)) {
                                subclasses.push({ symbol: subClassSymbol, uri });
                            }
                        }
                    }
                }
            }

        } catch (e) {
            console.error('[OverrideMark] Error finding subclasses:', e);
        }
        return subclasses;
    }

    private findClassSymbol(symbols: vscode.DocumentSymbol[], name: string): vscode.DocumentSymbol | undefined {
        for (const symbol of symbols) {
            if (symbol.kind === vscode.SymbolKind.Class && symbol.name === name) {
                return symbol;
            }
            if (symbol.children) {
                const found = this.findClassSymbol(symbol.children, name);
                if (found) return found;
            }
        }
        return undefined;
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
