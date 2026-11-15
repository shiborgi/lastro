# ADR 13: Imports Stage Evidence; Parsers Return Observations

**Status:** Accepted (0.1.0)

## Context

Importing a file must never silently create financial facts, and must be repeatable.

## Decision

- An import module only parses: a parser is a pure function from a file's text to observations. It decides nothing.
- The receiving module (`finance` or `sales`) owns everything else: the file's identity and provenance (importer id, version and configuration fingerprint), staging the lines as movements, their review states and their posting.
- A movement is evidence, not a financial record. It becomes one only by posting, which records what it became as links.

## Consequences

- The same file twice changes nothing; a parser change is visible in every file's provenance.
