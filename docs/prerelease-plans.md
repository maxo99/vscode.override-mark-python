# Roadmap & Remaining Tasks

## Publishing Readiness
- [ ] **Technical Setup**:
    - [ ] Run `vsce package` to verify the build bundle size.
    - [ ] Set up a GitHub Action for auto-publishing on tag.
- [ ] **Marketplace Publishing Steps**:
    1.  Create a Personal Access Token (PAT) on [Azure DevOps](https://dev.azure.com/).
    2.  Create a publisher on the [VS Code Marketplace Management](https://marketplace.visualstudio.com/manage).
    3.  Login locally: `vsce login <publisher id>`.
    4.  Publish: `vsce publish`.

## Future Improvements (Backlog)
- [x] **Caching Strategy** (High Priority for Performance):
    -   **Problem**: `executeReferenceProvider` is expensive and called frequently.
    -   **Solution**: Implement a `SubclassCache` singleton.
        -   **Structure**: `Map<ParentClassName, { uri: Uri, range: Range }[]>`
        -   **Logic**:
            1.  Check cache for parent class.
            2.  If hit, return cached subclasses.
            3.  If miss, run `executeReferenceProvider`, parse results, and cache.
        -   **Invalidation**:
            -   Listen to `workspace.onDidChangeTextDocument`.
            -   Aggressive: Clear entire cache on any change (easiest to implement, still better than no cache).
            -   Smart: Only invalidate if the changed file contains `class ... (...)` syntax.
- [ ] **Toggle Settings**: Add a setting to toggle "Parent -> Child" and "Child -> Parent" lens independently.
- [ ] **Localization**: Support multiple languages for CodeLens text.
