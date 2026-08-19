# Domain Docs

Before exploring the codebase, read these when present:

- `CONTEXT.md` at the repository root.
- `docs/adr/` entries relevant to the area being changed.

If they do not exist, proceed silently. Domain-modeling skills create them lazily when terminology or architectural decisions are resolved.

## Layout

This is a single-context repository:

```
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

Use the vocabulary defined in `CONTEXT.md`. Surface conflicts with existing ADRs explicitly instead of silently overriding them.
