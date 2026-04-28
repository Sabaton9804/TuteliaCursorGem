# Security Specification - Tutelia

## Data Invariants
- A case cannot exist without a valid `courtId`.
- Access to cases is restricted to users who are members of the corresponding `courtId`.
- Roles (judge, clerk, etc.) are trusted from the `users` subcollection within a `court`.

## The "Dirty Dozen" Payloads (Denial Tests)
1. Creating a case with a `courtId` the user doesn't belong to.
2. Updating a case's `radicado` (should be immutable after admission).
3. Reading cases from another court.
4. Injecting a 1MB string into a `caseId`.
5. Modifying another user's profile.
6. Deleting an action log (Action logs should be mostly immutable/append-only).
7. Self-assigning an 'admin' role in a court where the user is not defined.
8. Listing documents of a case without being a member of the court.
9. Attempting to update `createdAt` field.
10. Creating a document with a non-existent `caseId`.
11. Bypassing the `radicado` format validation.
12. Creating a case without being authenticated.

## Implementation Details
- `firestore.rules` enforces `isMember(courtId)` for every operation.
- `isValidId(id)` guards against ID poisoning.
- `update` rules will be matured to use `affectedKeys().hasOnly()` in a production hardening phase.
