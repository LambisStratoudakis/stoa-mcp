import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripPreamble,
  parseAcceptanceCriteria,
  parseConstraints,
  parseDecomposition,
  parseScenarios,
} from './parsers.js';

describe('stripPreamble', () => {
  it('removes preamble lines and horizontal rules', () => {
    const input = `I'm sandboxed and cannot access the internet.
Let me help you with that.
Based on your request, here is the output.
---

Actual content starts here.`;
    const result = stripPreamble(input);
    assert.equal(result, 'Actual content starts here.');
  });

  it('returns content unchanged when no preamble', () => {
    assert.equal(stripPreamble('Hello world'), 'Hello world');
  });

  it('handles empty string', () => {
    assert.equal(stripPreamble(''), '');
  });

  it('strips *** and ___ dividers', () => {
    const input = `Here's the result.
***
Real content`;
    assert.equal(stripPreamble(input), 'Real content');
  });
});

describe('parseAcceptanceCriteria', () => {
  it('extracts numbered items after DONE WHEN header', () => {
    const input = `Some preamble text.

DONE WHEN:
1. The API returns 200
2. The response includes a valid token
3. Error cases are handled

CONSTRAINTS:
Something else`;
    const result = parseAcceptanceCriteria(input);
    assert.deepEqual(result, [
      'The API returns 200',
      'The response includes a valid token',
      'Error cases are handled',
    ]);
  });

  it('falls back to non-empty lines when no structured format found', () => {
    assert.deepEqual(parseAcceptanceCriteria('Just some text'), ['Just some text']);
  });

  it('extracts plain numbered lines without DONE WHEN header', () => {
    const input = `1. Users can create recipes
2. Users can search recipes
3. Users can share recipes`;
    assert.deepEqual(parseAcceptanceCriteria(input), [
      'Users can create recipes',
      'Users can search recipes',
      'Users can share recipes',
    ]);
  });

  it('extracts bullet lines without DONE WHEN header', () => {
    const input = `- Users can create recipes
- Users can search recipes
* Users can share recipes`;
    assert.deepEqual(parseAcceptanceCriteria(input), [
      'Users can create recipes',
      'Users can search recipes',
      'Users can share recipes',
    ]);
  });

  it('handles case-insensitive header', () => {
    const input = `done when:
1. First item`;
    assert.deepEqual(parseAcceptanceCriteria(input), ['First item']);
  });
});

describe('parseConstraints', () => {
  it('parses all constraint sections', () => {
    const input = `MUSTS:
- Must be fast
- Must be secure

MUST NOTS:
- Must not leak data
* Must not crash

PREFERENCES:
1. Prefer JSON over XML

ESCALATION TRIGGERS:
- Latency over 500ms

FAILURE MODES:
- Network timeout`;
    const result = parseConstraints(input);
    assert.deepEqual(result, {
      musts: ['Must be fast', 'Must be secure'],
      must_nots: ['Must not leak data', 'Must not crash'],
      preferences: ['Prefer JSON over XML'],
      escalation_triggers: ['Latency over 500ms'],
      failure_modes: ['Network timeout'],
    });
  });

  it('wraps unstructured text as musts fallback', () => {
    const result = parseConstraints('No sections here');
    assert.deepEqual(result, {
      musts: ['No sections here'],
      must_nots: [],
      preferences: [],
      escalation_triggers: [],
      failure_modes: [],
    });
  });

  it('parses markdown header format from Claude Code', () => {
    const input = `## MUSTS
- Must be fast
- Must be secure

## Must Nots
- Must not leak data

**Preferences:**
- Prefer JSON over XML`;
    const result = parseConstraints(input);
    assert.deepEqual(result.musts, ['Must be fast', 'Must be secure']);
    assert.deepEqual(result.must_nots, ['Must not leak data']);
    assert.deepEqual(result.preferences, ['Prefer JSON over XML']);
  });

  it('parses valid JSON input', () => {
    const input = JSON.stringify({
      musts: ['Be fast'],
      must_nots: ['Leak data'],
      preferences: [],
      escalation_triggers: [],
      failure_modes: [],
    });
    const result = parseConstraints(input);
    assert.deepEqual(result.musts, ['Be fast']);
    assert.deepEqual(result.must_nots, ['Leak data']);
  });

  it('handles underscore variants', () => {
    const input = `MUST_NOTS:
- No logging secrets

ESCALATION_TRIGGERS:
- CPU over 90%

FAILURE_MODES:
- Disk full`;
    const result = parseConstraints(input);
    assert.deepEqual(result.must_nots, ['No logging secrets']);
    assert.deepEqual(result.escalation_triggers, ['CPU over 90%']);
    assert.deepEqual(result.failure_modes, ['Disk full']);
  });
});

describe('parseDecomposition', () => {
  it('returns null for "No decomposition needed"', () => {
    assert.equal(parseDecomposition('No decomposition needed for this task.'), null);
  });

  it('extracts JSON array of decomposition items', () => {
    const input = `Here is the decomposition:
[
  {"title": "Setup DB", "description": "Create tables", "estimate": "2h", "verify": "Run migrations"},
  {"title": "Add API", "description": "REST endpoints", "estimate": "4h", "verify": "Integration tests pass"}
]
End of decomposition.`;
    const result = parseDecomposition(input);
    assert.notEqual(result, null);
    assert.equal(result!.length, 2);
    assert.equal(result![0].title, 'Setup DB');
    assert.equal(result![1].verify, 'Integration tests pass');
  });

  it('returns null for invalid JSON', () => {
    assert.equal(parseDecomposition('Some text [not valid json]'), null);
  });

  it('returns null for missing required fields', () => {
    const input = '[{"title": "Only title"}]';
    assert.equal(parseDecomposition(input), null);
  });
});

describe('parseScenarios', () => {
  it('extracts scenario array from mixed content', () => {
    const input = `Here are the test scenarios:
[
  {"title": "Happy path", "given": "Valid input", "expected": "Returns 200"},
  {"title": "Bad input", "given": "Empty string", "expected": "Returns 400"}
]`;
    const result = parseScenarios(input);
    assert.equal(result.length, 2);
    assert.equal(result[0].title, 'Happy path');
    assert.equal(result[1].expected, 'Returns 400');
  });

  it('returns empty array when no JSON found', () => {
    assert.deepEqual(parseScenarios('No JSON here'), []);
  });

  it('returns empty array for invalid structure', () => {
    assert.deepEqual(parseScenarios('[{"wrong": "fields"}]'), []);
  });
});
