# Search revamp plan

**Goal:** search answers in under 200 ms. The handler is `code/app.py`.

Do we keep the old API?

Owner: @priya

## Steps

- [x] build the new index
- [ ] switch the API to it

## Risks

The index may not fit in memory on small machines.

## Testing

Load test with last month's queries.

Target date: 2026-12-01.
