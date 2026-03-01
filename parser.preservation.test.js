/**
 * Preservation Property Tests for Start Pattern Auto-Close
 * 
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 * 
 * CRITICAL: These tests MUST PASS on unfixed code - passing confirms baseline behavior to preserve
 * These tests verify that normal parsing behavior (with END patterns, proper session flow) 
 * continues to work after the fix
 * 
 * GOAL: Establish baseline behavior that must be preserved after implementing the fix
 */

const fc = require('fast-check');
const { createParser } = require('./parser');

// Test configuration matching pattern_config.json
const TEST_CONFIG = {
  start_patterns: ['START'],
  end_patterns: ['END'],
  success_patterns: ['SUCCESS'],
  failure_patterns: [],
  clickable_patterns: {},
  utterance_patterns: {},
  pattern_groups: {}
};

describe('Preservation Tests - Normal Parsing Behavior', () => {
  
  /**
   * Property 3: Preservation - Normal Start Pattern Handling
   * **Validates: Requirements 3.1**
   * 
   * Test that start_pattern when NOT in a block continues to work correctly
   */
  describe('Normal Start Pattern Handling (inBlock=false)', () => {
    
    test('Single START followed by END should create one entry', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START session\nEND session';
      
      const result = parser.parseText(logText);
      
      // This should work on unfixed code - normal session flow
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].allLines).toEqual(['START session', 'END session']);
      expect(result.finalInBlock).toBe(false);
      expect(result.finalBuffer.length).toBe(0);
    });

    test('START with lines and END should create complete entry', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START session\nline1\nline2\nEND session';
      
      const result = parser.parseText(logText);
      
      // Normal session flow should work on unfixed code
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].allLines).toEqual(['START session', 'line1', 'line2', 'END session']);
      expect(result.found).toBe(1);
      expect(result.matched).toBe(4);
    });

    test('Multiple complete sessions should all be saved', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START A\nEND A\nSTART B\nEND B\nSTART C\nEND C';
      
      const result = parser.parseText(logText);
      
      // Multiple normal sessions should work on unfixed code
      expect(result.entries.length).toBe(3);
      expect(result.entries[0].allLines).toEqual(['START A', 'END A']);
      expect(result.entries[1].allLines).toEqual(['START B', 'END B']);
      expect(result.entries[2].allLines).toEqual(['START C', 'END C']);
    });

    test('Property: Normal sessions with END always create entries', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 5 }), // Number of lines between START and END
          (numLines) => {
            const parser = createParser(TEST_CONFIG);
            const lines = ['START session'];
            for (let i = 0; i < numLines; i++) {
              lines.push(`line${i}`);
            }
            lines.push('END session');
            const logText = lines.join('\n');
            
            const result = parser.parseText(logText);
            
            // Normal session should work on unfixed code
            expect(result.entries.length).toBe(1);
            expect(result.entries[0].allLines.length).toBe(numLines + 2);
            expect(result.entries[0].allLines[0]).toBe('START session');
            expect(result.entries[0].allLines[result.entries[0].allLines.length - 1]).toBe('END session');
            expect(result.finalInBlock).toBe(false);
            expect(result.finalBuffer.length).toBe(0);
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  /**
   * Property 4: Preservation - End Pattern Handling
   * **Validates: Requirements 3.2**
   * 
   * Test that end_pattern handling saves complete sessions correctly
   */
  describe('End Pattern Handling (inBlock=true)', () => {
    
    test('END pattern should save complete session and reset buffer', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START session\nline1\nEND session';
      
      const result = parser.parseText(logText);
      
      // END pattern handling should work on unfixed code
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].allLines).toEqual(['START session', 'line1', 'END session']);
      expect(result.finalInBlock).toBe(false);
      expect(result.finalBuffer.length).toBe(0);
    });

    test('Multiple ENDs should each close their sessions', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START A\nEND A\nSTART B\nline1\nEND B';
      
      const result = parser.parseText(logText);
      
      // Multiple END patterns should work on unfixed code
      expect(result.entries.length).toBe(2);
      expect(result.entries[0].allLines).toEqual(['START A', 'END A']);
      expect(result.entries[1].allLines).toEqual(['START B', 'line1', 'END B']);
      expect(result.finalInBlock).toBe(false);
    });

    test('END should include itself in the entry', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START session\nEND session';
      
      const result = parser.parseText(logText);
      
      // END line should be included in the entry
      expect(result.entries[0].allLines).toContain('END session');
      expect(result.entries[0].allLines[result.entries[0].allLines.length - 1]).toBe('END session');
    });

    test('Property: END always closes session and resets state', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }), // Number of sessions
          (numSessions) => {
            const parser = createParser(TEST_CONFIG);
            const lines = [];
            for (let i = 0; i < numSessions; i++) {
              lines.push(`START session${i}`);
              lines.push(`line${i}`);
              lines.push(`END session${i}`);
            }
            const logText = lines.join('\n');
            
            const result = parser.parseText(logText);
            
            // All sessions should be closed properly
            expect(result.entries.length).toBe(numSessions);
            expect(result.finalInBlock).toBe(false);
            expect(result.finalBuffer.length).toBe(0);
            
            // Each entry should have START, line, END
            for (let i = 0; i < numSessions; i++) {
              expect(result.entries[i].allLines.length).toBe(3);
              expect(result.entries[i].allLines[0]).toContain('START');
              expect(result.entries[i].allLines[2]).toContain('END');
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  /**
   * Property 5: Preservation - Line Buffering
   * **Validates: Requirements 3.3**
   * 
   * Test that lines that are neither start nor end patterns are buffered correctly
   */
  describe('Line Buffering (inBlock=true)', () => {
    
    test('Lines between START and END should be buffered', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START session\nline1\nline2\nline3\nEND session';
      
      const result = parser.parseText(logText);
      
      // Line buffering should work on unfixed code
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].allLines).toEqual(['START session', 'line1', 'line2', 'line3', 'END session']);
    });

    test('Empty lines should be skipped', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START session\n\nline1\n\nline2\n\nEND session';
      
      const result = parser.parseText(logText);
      
      // Empty lines should be skipped (existing behavior)
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].allLines).toEqual(['START session', 'line1', 'line2', 'END session']);
    });

    test('Lines with various content should be buffered', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START session\nSUCCESS operation\ndata: 123\nerror: none\nEND session';
      
      const result = parser.parseText(logText);
      
      // All non-empty lines should be buffered
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].allLines.length).toBe(5);
      expect(result.entries[0].allLines).toContain('SUCCESS operation');
      expect(result.entries[0].allLines).toContain('data: 123');
      expect(result.entries[0].allLines).toContain('error: none');
    });

    test('Property: All lines between START and END are buffered in order', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 10 }),
          (contentLines) => {
            const parser = createParser(TEST_CONFIG);
            // Filter out lines that might match START or END patterns, and lines that would be trimmed to empty
            const safeLines = contentLines
              .filter(l => !l.includes('START') && !l.includes('END'))
              .filter(l => l.trim().length > 0); // Only keep lines that won't be skipped by trim
            if (safeLines.length === 0) return; // Skip if no safe lines
            
            const lines = ['START session', ...safeLines, 'END session'];
            const logText = lines.join('\n');
            
            const result = parser.parseText(logText);
            
            // All lines should be buffered in order
            expect(result.entries.length).toBe(1);
            expect(result.entries[0].allLines.length).toBe(safeLines.length + 2);
            expect(result.entries[0].allLines[0]).toBe('START session');
            expect(result.entries[0].allLines[result.entries[0].allLines.length - 1]).toBe('END session');
            
            // Check middle lines are in order (trimmed, since parser trims lines)
            for (let i = 0; i < safeLines.length; i++) {
              expect(result.entries[0].allLines[i + 1]).toBe(safeLines[i].trim());
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  /**
   * Property 6: Preservation - Normal EOF Handling
   * **Validates: Requirements 3.4**
   * 
   * Test that EOF with no buffered data calls finishParsing() normally
   */
  describe('Normal EOF Handling (inBlock=false)', () => {
    
    test('EOF after complete session should have empty buffer', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START session\nEND session';
      
      const result = parser.parseText(logText);
      
      // EOF with no buffered data should work on unfixed code
      expect(result.entries.length).toBe(1);
      expect(result.finalInBlock).toBe(false);
      expect(result.finalBuffer.length).toBe(0);
    });

    test('EOF after multiple complete sessions should have empty buffer', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START A\nEND A\nSTART B\nEND B';
      
      const result = parser.parseText(logText);
      
      // Multiple complete sessions ending at EOF should work
      expect(result.entries.length).toBe(2);
      expect(result.finalInBlock).toBe(false);
      expect(result.finalBuffer.length).toBe(0);
    });

    test('Empty log should handle EOF normally', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = '';
      
      const result = parser.parseText(logText);
      
      // Empty log should work on unfixed code
      expect(result.entries.length).toBe(0);
      expect(result.finalInBlock).toBe(false);
      expect(result.finalBuffer.length).toBe(0);
    });

    test('Log with only non-START lines should handle EOF normally', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'line1\nline2\nline3';
      
      const result = parser.parseText(logText);
      
      // Lines without START should be ignored (not in block)
      expect(result.entries.length).toBe(0);
      expect(result.finalInBlock).toBe(false);
      expect(result.finalBuffer.length).toBe(0);
    });

    test('Property: EOF after complete sessions always has empty buffer', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }), // Number of complete sessions
          (numSessions) => {
            const parser = createParser(TEST_CONFIG);
            const lines = [];
            for (let i = 0; i < numSessions; i++) {
              lines.push(`START session${i}`);
              lines.push(`line${i}`);
              lines.push(`END session${i}`);
            }
            const logText = lines.join('\n');
            
            const result = parser.parseText(logText);
            
            // EOF after complete sessions should have empty buffer
            expect(result.entries.length).toBe(numSessions);
            expect(result.finalInBlock).toBe(false);
            expect(result.finalBuffer.length).toBe(0);
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  /**
   * Counter and Progress Tracking Preservation
   * Test that found and matched counters remain accurate
   */
  describe('Counter Accuracy Preservation', () => {
    
    test('found counter should match number of entries', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START A\nEND A\nSTART B\nEND B\nSTART C\nEND C';
      
      const result = parser.parseText(logText);
      
      // Counter accuracy should work on unfixed code
      expect(result.found).toBe(3);
      expect(result.entries.length).toBe(3);
    });

    test('matched counter should match total lines in all entries', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START A\nline1\nEND A\nSTART B\nline2\nline3\nEND B';
      
      const result = parser.parseText(logText);
      
      // matched should count all lines in entries
      expect(result.matched).toBe(7); // 3 lines in entry A + 4 lines in entry B
      expect(result.entries[0].allLines.length + result.entries[1].allLines.length).toBe(7);
    });

    test('Property: Counters always match entry data', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }), // Number of sessions
          fc.integer({ min: 0, max: 3 }), // Lines per session
          (numSessions, linesPerSession) => {
            const parser = createParser(TEST_CONFIG);
            const lines = [];
            for (let i = 0; i < numSessions; i++) {
              lines.push(`START session${i}`);
              for (let j = 0; j < linesPerSession; j++) {
                lines.push(`line${i}_${j}`);
              }
              lines.push(`END session${i}`);
            }
            const logText = lines.join('\n');
            
            const result = parser.parseText(logText);
            
            // Counters should match entry data
            expect(result.found).toBe(numSessions);
            expect(result.entries.length).toBe(numSessions);
            
            const totalLines = result.entries.reduce((sum, e) => sum + e.allLines.length, 0);
            expect(result.matched).toBe(totalLines);
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});
