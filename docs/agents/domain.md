# Domain Docs

Consult these when relevant to the task and present:

- `CONTEXT.md` for domain vocabulary and behavior.
- `docs/adr/` entries for architectural decisions affecting the change.

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
