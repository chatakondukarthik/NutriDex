# NutriPlan — Documentation System

**Status:** Active
**Purpose:** Define how NutriPlan keeps product and technical knowledge, so
decisions are not re-litigated and scope does not drift.

---

## Why this exists

Three failure modes kill small products, and all three are documentation
failures:

| Failure | What it looks like | What prevents it |
|---|---|---|
| Re-litigating decisions | "Should recipes be blocks or flat lists?" — argued again in month three | Immutable decision records |
| Losing the *why* | Code says `status = 'estimated'`; nobody remembers why | Decision records linked from code |
| Scope creep | "While we're in here, let's add shopping lists" | One scope matrix, one home per item |

The rule of thumb: **docs are for the next person, who is you in six weeks
with no memory of today.**

---

## The four document types

Each type answers a different question and has a different lifecycle. Mixing
them is what makes documentation rot.

| Type | Question | Lifecycle | How it changes |
|---|---|---|---|
| **Decision record** | *Why* did we choose this? | Immutable once accepted | Superseded by a new record. Never edited. |
| **Spec** | *What* are we building? | Living during discovery, frozen at commitment | Changes require a decision record |
| **Research note** | *What did we learn?* | Time-stamped snapshot | Never edited. A new note supersedes it. |
| **Reference** | *How* does it work? | Living | Updated in place |

### Decision records

Modelled on Nygard's ADRs.

- One decision per record.
- Fixed shape: **Context → Decision → Consequences → Alternatives rejected**.
- Once accepted, the body is frozen. Reversing means a new record that
  supersedes the old one, linked both ways.
- Written when a decision is **hard to reverse** or **expensive to
  rediscover**. Not for reversible implementation details.

### Specs

Modelled on the PRD convention and Basecamp's Shape Up pitch.

- Iterated freely during discovery, **frozen at commitment** — the moment
  build starts, new ideas go to the scope matrix, not into the spec.
- Every spec has: problem, appetite, scope, acceptance criteria, and
  **explicit non-goals**. A spec without non-goals is a wish list.

### Research notes

- Named `YYYY-MM-DD-topic.md` under `research/notes/`.
- Shape: **Question → Method → Findings → What this changes → Still open**.
- Never edited. If the conclusion changes, write a new note and link back.
- A note that changes a decision must produce a decision record.

### Reference

Living documents describing how the system works today: data model,
nutrition contract, stack, runbook.

- Updated in place, in the same commit as the change they describe.
- If a reference doc and the code disagree, one of them is wrong — fix it
  immediately.

---

## The scope matrix

The single most useful document. Every idea gets exactly one home, and moving
between columns is a deliberate act.

| Column | Meaning | Test |
|---|---|---|
| **In** | Being built now | Does the current slice need it to be usable? |
| **Next** | Designed, not built | Is it blocked only by the previous column shipping? |
| **Later** | Known, undesigned | Would we still want it in a year? |
| **Never** | Rejected | Was it rejected for a reason we would forget? |

Rules:

- An item may not appear in two columns. Duplication is how scope creep hides.
- "Never" items must record why, or they get re-proposed every quarter.
- Promotion requires a decision record.

---

## Maintenance rules

1. **Write the decision when you make it.** A week later it is a
   reconstruction, not a record.
2. **Link, don't copy.** One document owns a fact; others link to it.
3. **Every research note ends with "what this changes".** "Nothing" is a fine
   answer, stated explicitly.
4. **Update references in the same commit as the code.** Stale reference docs
   are worse than none, because they are trusted.
5. **Delete superseded documents.** Git is the archive.
6. **Review the scope matrix at the start of every slice.**

---

## Templates

### Decision record

```markdown
### D-0NN — Title in one sentence

**Status:** Proposed | Accepted | Superseded by D-0MM
**Date:** YYYY-MM-DD

**Context** — what forced this decision.

**Decision** — what we will do, stated so a new engineer could implement it.

**Consequences** — what gets easier, what gets harder, what we owe the user.

**Alternatives rejected** — each with the reason it lost. The most valuable
section.
```

### Research note

```markdown
# YYYY-MM-DD — Topic

**Question:** the one thing this note answers.
**Method:** what was searched, built, measured or asked.

## Findings
Numbered, each with a source.

## What this changes
A decision reference, or "nothing".

## Still open
What this did not resolve.
```

---

## What we deliberately do not do

- **No wiki.** If it is not in the repo, it drifts.
- **No meeting notes as documentation.** Notes are inputs; decisions are
  outputs.
- **No document per feature.** Features get a spec section, not a file.
- **No versioned spec history.** Git has it; the register has the decisions.

---

## Sources

| Practice | Origin | What we took |
|---|---|---|
| Architecture Decision Records | Michael Nygard; MADR | Immutable, numbered, superseded-not-edited |
| Shape Up pitch | Basecamp | Problem / appetite / solution / rabbit holes / no-gos |
| Working Backwards PR/FAQ | Amazon | Write the outcome before building it |
| PRD | Common product practice | Living during discovery, frozen at commitment |
| Docs as code | Common engineering practice | Docs live in the repo, reviewed with the code |
| Walking skeleton | Cockburn; *Growing Object-Oriented Software* | Thin end-to-end slice before breadth |
